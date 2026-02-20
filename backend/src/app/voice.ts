import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import axios from "axios";
import type { Telegram } from "telegraf";
import { AppConfig } from "./config";

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
  const outputPath = inputPath.replace(/\.(ogg|oga|opus)$/i, "") + "_16k.wav";
  execFileSync("ffmpeg", ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", outputPath], { stdio: "pipe" });
  return outputPath;
}

async function downloadTelegramVoice(telegram: Telegram, token: string, fileId: string): Promise<string> {
  const file = await telegram.getFile(fileId);
  if (!file.file_path) throw new Error("telegram file_path missing");
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30_000 });
  const tmpDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const out = path.join(tmpDir, `voice_${Date.now()}_${fileId.replace(/[^a-zA-Z0-9_-]/g, "_")}.ogg`);
  fs.writeFileSync(out, res.data);
  return out;
}

async function transcribeWav(config: AppConfig, wavPath: string): Promise<string> {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }
  const b64 = fs.readFileSync(wavPath).toString("base64");
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

  const response = await axios.post<{ choices?: Array<{ message?: { content?: unknown } }> }>(
    "https://openrouter.ai/api/v1/chat/completions",
    payload,
    { headers, timeout: 90_000, maxBodyLength: Infinity }
  );

  const text = extractText(response.data?.choices?.[0]?.message?.content);
  if (!text) throw new Error("empty transcript");
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
  } finally {
    for (const p of [oggPath, wavPath]) {
      if (p && fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* noop */ }
      }
    }
  }
}
