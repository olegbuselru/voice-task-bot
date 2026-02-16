import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import axios from "axios";
import { Telegraf } from "telegraf";

/**
 * Get Telegram file download URL and download file to temp path.
 */
export async function downloadVoiceFromTelegram(
  bot: Telegraf,
  fileId: string
): Promise<string> {
  try {
    const file = await bot.telegram.getFile(fileId);
    if (!file.file_path) {
      throw new Error("Telegram file_path is missing");
    }
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
    const tempDir = path.join(process.cwd(), "tmp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempPath = path.join(tempDir, `voice_${Date.now()}_${fileId.replace(/[^a-zA-Z0-9]/g, "_")}.ogg`);
    fs.writeFileSync(tempPath, response.data);
    return tempPath;
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Failed to download voice from Telegram: ${err.message}`);
    }
    throw new Error("Failed to download voice from Telegram");
  }
}

/**
 * Convert ogg/opus to 16kHz mono WAV via ffmpeg. Returns path to temp WAV file.
 * OpenRouter input_audio accepts base64 WAV; conversion ensures consistent format.
 */
function convertToWav(oggPath: string): string {
  const wavPath = oggPath.replace(/\.(ogg|opus)$/i, "_conv.wav");
  try {
    execFileSync("ffmpeg", [
      "-y",
      "-i", oggPath,
      "-ar", "16000",
      "-ac", "1",
      "-f", "wav",
      wavPath,
    ], { stdio: "pipe" });
    return wavPath;
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`ffmpeg conversion failed: ${err.message}`);
    }
    throw new Error("ffmpeg conversion failed");
  }
}

/**
 * Extract plain text from OpenRouter chat completion message content.
 */
function extractTranscriptFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const maybeText = (item as { text?: unknown }).text;
        return typeof maybeText === "string" ? maybeText : "";
      })
      .filter(Boolean);
    return parts.join(" ").trim();
  }

  return "";
}

/**
 * Transcribe audio file via OpenRouter chat/completions with input_audio(base64).
 * Expects ogg/opus; converts to WAV before sending.
 */
export async function transcribeWithOpenRouter(filePath: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("OPENROUTER_API_KEY is not set; cannot transcribe voice");
  }

  const model = process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-audio-mini";
  const referer = process.env.OPENROUTER_REFERER?.trim();
  const title = process.env.OPENROUTER_TITLE?.trim();

  let wavPath: string | null = null;
  const controller = new AbortController();
  const timeoutMs = 90_000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (!fs.existsSync(filePath)) {
      throw new Error("Temp voice file not found");
    }
    wavPath = convertToWav(filePath);
    const audioBuffer = fs.readFileSync(wavPath);
    const audioBase64 = audioBuffer.toString("base64");

    const payload = {
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Верни только текст распознанной речи. Без пояснений.",
            },
            {
              type: "input_audio",
              input_audio: {
                data: audioBase64,
                format: "wav",
              },
            },
          ],
        },
      ],
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (referer) {
      headers["HTTP-Referer"] = referer;
    }
    if (title) {
      headers["X-Title"] = title;
    }

    const response = await axios.post<{ choices?: Array<{ message?: { content?: unknown } }> }>(
      "https://openrouter.ai/api/v1/chat/completions",
      payload,
      {
        headers,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        signal: controller.signal,
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    const text = extractTranscriptFromContent(content);
    if (!text) {
      throw new Error("OpenRouter returned empty transcript");
    }
    return text;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const body = err.response?.data;
      const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(`OpenRouter API error (${status ?? "network"}): ${bodyStr ?? err.message}`);
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`OpenRouter transcription timeout after ${timeoutMs}ms`);
    }
    if (err instanceof Error) {
      throw new Error(`OpenRouter transcription failed: ${err.message}`);
    }
    throw new Error("OpenRouter transcription failed");
  } finally {
    clearTimeout(timeoutId);
    if (wavPath && fs.existsSync(wavPath)) {
      try {
        fs.unlinkSync(wavPath);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Delete temporary file. Safe to call if file already removed.
 */
export function deleteTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Full pipeline: download voice from Telegram, transcribe with OpenRouter, delete temp file.
 */
export async function processVoiceMessage(
  bot: Telegraf,
  fileId: string
): Promise<string> {
  let tempPath: string | null = null;
  try {
    tempPath = await downloadVoiceFromTelegram(bot, fileId);
    const transcript = await transcribeWithOpenRouter(tempPath);
    if (!transcript || transcript.length === 0) {
      throw new Error("Empty transcript from OpenRouter");
    }
    return transcript;
  } finally {
    if (tempPath) {
      deleteTempFile(tempPath);
    }
  }
}
