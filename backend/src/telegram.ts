import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { PrismaClient } from "@prisma/client";
import { processVoiceMessage } from "./services/transcription";
import { parseTaskFromTranscript } from "./services/taskParser";

const prisma = new PrismaClient();

function createBot(): Telegraf {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  const bot = new Telegraf(token);

  bot.on(message("voice"), async (ctx: Context) => {
    try {
      const msg = ctx.message;
      if (!msg || !("voice" in msg)) {
        await ctx.reply("Голосовое сообщение не найдено.");
        return;
      }
      const voice = msg.voice;
      if (!voice) {
        await ctx.reply("Голосовое сообщение не найдено.");
        return;
      }
      const fileId = voice.file_id;
      if (!fileId) {
        await ctx.reply("Не удалось получить файл голосового сообщения.");
        return;
      }
      const transcript = await processVoiceMessage(bot, fileId);
      if (!transcript || transcript.trim().length === 0) {
        await ctx.reply("Не удалось распознать речь. Попробуйте ещё раз.");
        return;
      }
      const parsed = parseTaskFromTranscript(transcript);
      const task = await prisma.task.create({
        data: {
          text: parsed.text,
          originalText: parsed.originalText,
          important: parsed.important,
          deadline: parsed.deadline,
          status: "active",
        },
      });
      const deadlineStr = task.deadline
        ? ` до ${task.deadline.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`
        : "";
      await ctx.reply(`Задача создана${deadlineStr}: ${task.text}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Voice message processing error:", msg);
      if (msg.includes("OPENAI_API_KEY") || msg.includes("OpenAI")) {
        console.error("Check OPENAI_API_KEY and OpenAI API availability.");
      }
      if (msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("Prisma")) {
        console.error("Check DATABASE_URL and database availability.");
      }
      await ctx.reply("Ошибка при обработке голосового сообщения. Попробуйте позже.");
    }
  });

  return bot;
}

let botInstance: Telegraf | null = null;

export function getBot(): Telegraf {
  if (!botInstance) {
    botInstance = createBot();
  }
  return botInstance;
}

export function getWebhookCallback(): (req: import("express").Request, res: import("express").Response) => void | Promise<void> {
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET || undefined;
  return getBot().webhookCallback("/telegram/webhook", { secretToken }) as (req: import("express").Request, res: import("express").Response) => void | Promise<void>;
}
