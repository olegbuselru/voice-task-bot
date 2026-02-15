import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import axios from "axios";
import FormData from "form-data";
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
 * OpenAI Whisper accepts wav; conversion ensures consistent format.
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
 * Transcribe audio file via OpenAI Whisper API.
 * Expects ogg/opus; converts to WAV and sends to API.
 */
export async function transcribeWithWhisper(filePath: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("OPENAI_API_KEY is not set; cannot transcribe voice");
  }

  let wavPath: string | null = null;
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error("Temp voice file not found");
    }
    wavPath = convertToWav(filePath);

    const form = new FormData();
    form.append("file", fs.createReadStream(wavPath), {
      filename: "audio.wav",
      contentType: "audio/wav",
    });
    form.append("model", "whisper-1");
    form.append("language", "ru");

    const response = await axios.post<{ text?: string }>(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 60_000,
      }
    );

    const text = response.data?.text?.trim() ?? "";
    if (!text) {
      throw new Error("OpenAI Whisper returned empty transcript");
    }
    return text;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const msg = err.response?.data?.error?.message ?? err.message;
      throw new Error(`OpenAI API error (${status ?? "network"}): ${msg}`);
    }
    if (err instanceof Error) {
      throw new Error(`Whisper transcription failed: ${err.message}`);
    }
    throw new Error("Whisper transcription failed");
  } finally {
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
 * Full pipeline: download voice from Telegram, transcribe with OpenAI Whisper, delete temp file.
 */
export async function processVoiceMessage(
  bot: Telegraf,
  fileId: string
): Promise<string> {
  let tempPath: string | null = null;
  try {
    tempPath = await downloadVoiceFromTelegram(bot, fileId);
    const transcript = await transcribeWithWhisper(tempPath);
    if (!transcript || transcript.length === 0) {
      throw new Error("Empty transcript from Whisper");
    }
    return transcript;
  } finally {
    if (tempPath) {
      deleteTempFile(tempPath);
    }
  }
}
