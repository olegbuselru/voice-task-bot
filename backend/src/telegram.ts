import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { PrismaClient } from "@prisma/client";
import { processVoiceMessage } from "./services/transcription";
import {
  parseTherapistVoiceTranscript,
  normalizeClientName,
  parseTaskFromTranscript,
} from "./services/taskParser";
import { nluParseCommand } from "./services/therapistNlu";
import { ensureSettings, executeTherapistAction } from "./services/therapistExecutor";

const prisma = new PrismaClient();

function getChatId(ctx: Context): string | null {
  const maybeChat = (ctx as unknown as { chat?: { id?: number | string } }).chat;
  if (!maybeChat || maybeChat.id == null) return null;
  return String(maybeChat.id);
}

function toInlineKeyboard(buttons: Array<{ text: string; callbackData: string }>) {
  const rows = buttons.map((b) => [{ text: b.text, callback_data: b.callbackData }]);
  return { inline_keyboard: rows } as const;
}

function createBot(): Telegraf {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  const bot = new Telegraf(token);

  bot.start(async (ctx: Context) => {
    try {
      const chatId = getChatId(ctx);
      if (chatId) {
        await ensureSettings(prisma, chatId);
      }
      await ctx.reply(
        "Готово. Отправьте голосом или текстом команду: запись, свободные слоты, отмена, рабочие часы."
      );
    } catch {
      await ctx.reply("Не удалось инициализировать настройки. Попробуйте позже.");
    }
  });

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

      const nluAction = await nluParseCommand(transcript);
      if (nluAction && nluAction.intent !== "unknown") {
        const result = await executeTherapistAction({
          prisma,
          action: nluAction,
          originalText: transcript,
          chatId: getChatId(ctx),
        });

        if (result.buttons && result.buttons.length > 0) {
          await ctx.reply(result.text, {
            reply_markup: toInlineKeyboard(result.buttons),
          });
        } else {
          await ctx.reply(result.text);
        }
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

  bot.on(message("text"), async (ctx: Context) => {
    try {
      const msg = ctx.message;
      if (!msg || !("text" in msg)) return;
      const text = msg.text?.trim();
      if (!text) return;

      const action = await nluParseCommand(text);
      if (!action || action.intent === "unknown") {
        return;
      }

      const result = await executeTherapistAction({
        prisma,
        action,
        originalText: text,
        chatId: getChatId(ctx),
      });

      if (result.buttons && result.buttons.length > 0) {
        await ctx.reply(result.text, {
          reply_markup: toInlineKeyboard(result.buttons),
        });
      } else {
        await ctx.reply(result.text);
      }
    } catch {
      await ctx.reply("Ошибка обработки команды. Попробуйте позже.");
    }
  });

  bot.on("callback_query", async (ctx: Context) => {
    try {
      const callback = (ctx as unknown as { callbackQuery?: { data?: string } }).callbackQuery;
      const data = callback?.data;
      if (!data) return;

      if (data.startsWith("slot|")) {
        const [, clientId, startTsRaw] = data.split("|");
        const startTs = Number(startTsRaw);
        if (!clientId || !Number.isFinite(startTs)) {
          await ctx.reply("Не удалось создать запись из выбранного слота.");
          return;
        }

        const settings = await prisma.therapistSettings.findFirst({ orderBy: { createdAt: "asc" } });
        const sessionMinutes = settings?.sessionMinutes ?? 50;
        const startAt = new Date(startTs);
        const endAt = new Date(startAt.getTime() + sessionMinutes * 60_000);

        const appointment = await prisma.appointment.create({
          data: {
            clientId,
            startAt,
            endAt,
            kind: "session",
            status: "planned",
          },
          include: { client: { select: { displayName: true } } },
        });

        await ctx.reply(`Сделал: запись создана для ${appointment.client.displayName}.`);
        await (ctx as unknown as { answerCbQuery: (text?: string) => Promise<void> }).answerCbQuery("Готово");
        return;
      }

      if (data.startsWith("cancel_yes|")) {
        const [, appointmentId] = data.split("|");
        if (appointmentId) {
          await prisma.appointment.update({
            where: { id: appointmentId },
            data: { status: "canceled" },
          });
          await ctx.reply("Сделал: запись отменена.");
          await (ctx as unknown as { answerCbQuery: (text?: string) => Promise<void> }).answerCbQuery("Отменено");
        }
        return;
      }

      if (data.startsWith("cancel_no|")) {
        await ctx.reply("Сделал: отмену не выполняю.");
        await (ctx as unknown as { answerCbQuery: (text?: string) => Promise<void> }).answerCbQuery("Оставили запись");
      }
    } catch {
      await ctx.reply("Ошибка обработки действия. Попробуйте позже.");
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
