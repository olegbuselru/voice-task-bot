import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import axios from "axios";
import type { Telegram } from "telegraf";
import { AppConfig } from "./config";
import { logError, logInfo } from "./logger";

export class VoiceUserFacingError extends Error {
  userMessage: string;

  constructor(message: string, userMessage: string) {
    super(message);
    this.name = "VoiceUserFacingError";
    this.userMessage = userMessage;
  }
}

function truncate(value: string, max = 500): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function maskTelegramFileUrl(url: string): string {
  return url.replace(/\/file\/bot[^/]+\//, "/file/botTOKEN/");
}

let ffmpegChecked = false;
let ffmpegAvailable = false;

export function checkFfmpegAvailability(): boolean {
  if (ffmpegChecked) return ffmpegAvailable;
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "pipe" });
    ffmpegAvailable = true;
    logInfo("ffmpeg_check", { status: "ok" });
  } catch (err) {
    ffmpegAvailable = false;
    logError("ffmpeg_check_failed", err, { status: "missing" });
  }
  ffmpegChecked = true;
  return ffmpegAvailable;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
        ? String((item as { text: string }).text)
        : ""))
      .join(" ")
      .trim();
  }
  return "";
}

function toWav16k(inputPath: string): string {
  if (!checkFfmpegAvailability()) {
    throw new VoiceUserFacingError(
      "ffmpeg binary is missing",
      "Голос сейчас недоступен: на сервере не установлен ffmpeg. Отправь текстом."
    );
  }
  const outputPath = inputPath.replace(/\.(ogg|oga|opus)$/i, "") + "_16k.wav";
  try {
    execFileSync("ffmpeg", ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", outputPath], { stdio: "pipe" });
    return outputPath;
  } catch (err) {
    const anyErr = err as { stderr?: Buffer | string; message?: string };
    const stderrText = anyErr?.stderr
      ? Buffer.isBuffer(anyErr.stderr)
        ? anyErr.stderr.toString("utf8")
        : String(anyErr.stderr)
      : anyErr?.message || "ffmpeg failed";
    logError("voice_ffmpeg_convert_failed", err, { inputPath, outputPath, stderr: truncate(stderrText, 600) });
    throw new VoiceUserFacingError(
      `ffmpeg conversion failed: ${truncate(stderrText, 200)}`,
      "Не удалось обработать голосовой файл. Отправь текстом."
    );
  }
}

async function downloadTelegramVoice(telegram: Telegram, token: string, fileId: string): Promise<string> {
  const file = await telegram.getFile(fileId);
  if (!file.file_path) throw new Error("telegram file_path missing");
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30_000 });
  const tmpDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.accessSync(tmpDir, fs.constants.W_OK);
  const out = path.join(tmpDir, `voice_${Date.now()}_${fileId.replace(/[^a-zA-Z0-9_-]/g, "_")}.ogg`);
  fs.writeFileSync(out, res.data);
  logInfo("voice_downloaded", {
    fileId,
    telegramPath: file.file_path,
    downloadUrl: maskTelegramFileUrl(url),
    bytes: Buffer.byteLength(res.data),
    localPath: out,
  });
  return out;
}

async function transcribeWav(config: AppConfig, wavPath: string): Promise<string> {
  if (!config.openRouterApiKey || !config.openRouterAudioModel?.trim()) {
    throw new VoiceUserFacingError(
      "OpenRouter key/model is not configured",
      "Голос сейчас недоступен: не настроен ключ/модель. Отправь текстом."
    );
  }
  const wavBuffer = fs.readFileSync(wavPath);
  const b64 = wavBuffer.toString("base64");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.openRouterApiKey}`,
    "Content-Type": "application/json",
  };
  if (config.openRouterReferer) headers["HTTP-Referer"] = config.openRouterReferer;
  if (config.openRouterTitle) headers["X-Title"] = config.openRouterTitle;

  const payload = {
    model: config.openRouterAudioModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Распознай голосовое сообщение и верни только текст." },
          { type: "input_audio", input_audio: { data: b64, format: "wav" } },
        ],
      },
    ],
  };

  logInfo("voice_transcribe_request", {
    model: config.openRouterAudioModel,
    wavPath,
    wavBytes: wavBuffer.length,
  });

  let response;
  try {
    response = await axios.post<{ choices?: Array<{ message?: { content?: unknown } }> }>(
      "https://openrouter.ai/api/v1/chat/completions",
      payload,
      { headers, timeout: 90_000, maxBodyLength: Infinity }
    );
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const body = typeof err.response?.data === "string" ? err.response.data : JSON.stringify(err.response?.data || {});
      logError("voice_transcribe_http_failed", err, {
        model: config.openRouterAudioModel,
        status: err.response?.status ?? "network",
        body: truncate(body, 600),
      });
    }
    throw new VoiceUserFacingError("OpenRouter transcription request failed", "Не удалось распознать голос. Отправь текстом.");
  }

  logInfo("voice_transcribe_response", {
    model: config.openRouterAudioModel,
    status: response.status,
  });

  const text = extractText(response.data?.choices?.[0]?.message?.content);
  if (!text) {
    throw new VoiceUserFacingError("empty transcript", "Не удалось распознать голос. Отправь текстом.");
  }
  return text;
}

export async function transcribeVoiceFromTelegram(params: {
  telegram: Telegram;
  fileId: string;
  config: AppConfig;
}): Promise<string> {
  let oggPath: string | null = null;
  let wavPath: string | null = null;
  try {
    oggPath = await downloadTelegramVoice(params.telegram, params.config.telegramBotToken, params.fileId);
    wavPath = toWav16k(oggPath);
    return await transcribeWav(params.config, wavPath);
  } catch (err) {
    if (err instanceof VoiceUserFacingError) {
      throw err;
    }
    throw new VoiceUserFacingError("voice pipeline failed", "Не удалось обработать голос. Отправь текстом.");
  } finally {
    for (const p of [oggPath, wavPath]) {
      if (p && fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* noop */ }
      }
    }
  }
}

export function getVoiceUserMessage(err: unknown): string {
  if (err instanceof VoiceUserFacingError) {
    return err.userMessage;
  }
  return "Не удалось обработать голос. Отправь текстом.";
}
