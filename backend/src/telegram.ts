import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { PrismaClient } from "@prisma/client";
import { processVoiceMessage } from "./services/transcription";
import {
  parseTherapistVoiceTranscript,
  normalizeClientName,
  parseTaskFromTranscript,
} from "./services/taskParser";

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
      let parsed = parseTherapistVoiceTranscript(transcript);
      if (!parsed.task.text || parsed.task.text.trim().length === 0) {
        parsed = { clientDisplayName: null, task: parseTaskFromTranscript(transcript) };
      }

      let clientId: string | null = null;
      if (parsed.clientDisplayName) {
        const normalizedName = normalizeClientName(parsed.clientDisplayName);
        if (normalizedName.length > 0) {
          const client = await prisma.client.upsert({
            where: { normalizedName },
            update: { displayName: parsed.clientDisplayName },
            create: {
              displayName: parsed.clientDisplayName,
              normalizedName,
            },
            select: { id: true },
          });
          clientId = client.id;
        }
      }

      const task = await prisma.task.create({
        data: {
          text: parsed.task.text,
          originalText: parsed.task.originalText,
          important: parsed.task.important,
          deadline: parsed.task.deadline,
          status: "active",
          clientId,
        },
      });
      const deadlineStr = task.deadline
        ? ` до ${task.deadline.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`
        : "";
      const clientPrefix = parsed.clientDisplayName ? `[${parsed.clientDisplayName}] ` : "";
      await ctx.reply(`Задача создана${deadlineStr}: ${clientPrefix}${task.text}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Voice message processing error:", msg);
      if (msg.includes("OPENROUTER_API_KEY") || msg.includes("OpenRouter")) {
        console.error("Check OPENROUTER_API_KEY and OpenRouter API availability.");
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
