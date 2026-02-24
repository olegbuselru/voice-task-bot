import express, { Request, Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { extractUserInput } from "./inputExtractor";
import { parseReminderCommand } from "./reminderParser";
import {
  buildConfirmationReply,
  buildMissingDateReply,
  buildMissingTextReply,
  buildParseFailedReply,
} from "./reminderReplies";
import { sendTelegramMessage } from "./telegramClient";
import { TelegramUpdate } from "./types";

const MOSCOW_TIMEZONE = "Europe/Moscow";

function requireEnv(name: "TELEGRAM_BOT_TOKEN"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const port = Number(process.env.PORT || 3000);
const telegramBotToken = requireEnv("TELEGRAM_BOT_TOKEN");
const cronSecret = process.env.CRON_SECRET?.trim() || "";
const ownerChatId = process.env.OWNER_CHAT_ID?.trim() || "";

const prisma = new PrismaClient();
const app = express();
app.use(express.json({ limit: "512kb" }));

function logInfo(event: string, payload: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", event, ...payload }));
}

function logError(event: string, error: unknown, payload: Record<string, unknown> = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: "error", event, message, ...payload }));
}

async function markUpdateProcessed(updateId: number): Promise<boolean> {
  try {
    await prisma.processedUpdate.create({ data: { id: updateId } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}

function normalizeCommandText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function getMoscowDateParts(utc: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: MOSCOW_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(utc);
  const byType = (type: string): number => Number(parts.find((part) => part.type === type)?.value || "0");
  return {
    year: byType("year"),
    month: byType("month"),
    day: byType("day"),
  };
}

function mskToUtcDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0, 0));
}

function getMskTodayRangeUtc(nowUtc = new Date()): { from: Date; to: Date } {
  const { year, month, day } = getMoscowDateParts(nowUtc);
  const from = mskToUtcDate(year, month, day, 0, 0);
  const to = new Date(from.getTime());
  to.setUTCDate(to.getUTCDate() + 1);
  return { from, to };
}

function getMskTomorrowStartUtc(nowUtc = new Date()): Date {
  const tomorrow = getMskTodayRangeUtc(nowUtc).from;
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow;
}

function formatMskDateTime(utc: Date): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(utc);
  const byType = (type: string): string => parts.find((part) => part.type === type)?.value || "00";
  return {
    date: `${byType("day")}.${byType("month")}`,
    time: `${byType("hour")}:${byType("minute")}`,
  };
}

function formatReminderLines(reminders: Array<{ text: string; remindAt: Date; sentAt: Date | null }>, header: string, emptyText: string): string {
  if (reminders.length === 0) {
    return `${header}\n${emptyText}`;
  }

  const lines = reminders.map((reminder) => {
    const stamp = reminder.sentAt ?? reminder.remindAt;
    const label = formatMskDateTime(stamp);
    return `• ${label.date} ${label.time} — ${reminder.text}`;
  });

  return `${header}\n${lines.join("\n")}`;
}

async function sendBoxView(chatId: string): Promise<void> {
  const reminders = await prisma.reminder.findMany({
    where: {
      chatId,
      status: "sent",
    },
    orderBy: [{ sentAt: "desc" }, { remindAt: "desc" }],
    take: 30,
    select: { text: true, remindAt: true, sentAt: true },
  });

  await sendTelegramMessage(telegramBotToken, chatId, formatReminderLines(reminders, "📥 Коробка", "Пока пусто."));
}

async function sendAllFutureView(chatId: string): Promise<void> {
  const from = getMskTomorrowStartUtc();
  const reminders = await prisma.reminder.findMany({
    where: {
      chatId,
      status: "scheduled",
      remindAt: { gte: from },
    },
    orderBy: { remindAt: "asc" },
    take: 100,
    select: { text: true, remindAt: true, sentAt: true },
  });

  await sendTelegramMessage(telegramBotToken, chatId, formatReminderLines(reminders, "🗂 Все задачи", "Нет будущих напоминаний."));
}

async function sendTodayView(chatId: string): Promise<void> {
  const range = getMskTodayRangeUtc();
  const reminders = await prisma.reminder.findMany({
    where: {
      chatId,
      status: "scheduled",
      remindAt: { gte: range.from, lt: range.to },
    },
    orderBy: { remindAt: "asc" },
    take: 100,
    select: { text: true, remindAt: true, sentAt: true },
  });

  await sendTelegramMessage(telegramBotToken, chatId, formatReminderLines(reminders, "📅 Что сегодня", "На сегодня напоминаний нет."));
}

async function runCronTick(trigger: "http" | "owner"): Promise<{ dueCount: number; sentCount: number }> {
  const now = new Date();
  const dueReminders = await prisma.reminder.findMany({
    where: {
      status: "scheduled",
      remindAt: { lte: now },
    },
    orderBy: { remindAt: "asc" },
    take: 100,
  });

  logInfo("cron_tick_start", { trigger, countDue: dueReminders.length });

  let sentCount = 0;

  for (const reminder of dueReminders) {
    const sentAt = new Date();
    const claimed = await prisma.reminder.updateMany({
      where: {
        id: reminder.id,
        status: "scheduled",
      },
      data: {
        status: "sent",
        sentAt,
      },
    });

    if (claimed.count !== 1) {
      continue;
    }

    try {
      await sendTelegramMessage(telegramBotToken, reminder.chatId, `🔔 Напоминание: ${reminder.text}`);
      sentCount += 1;
      logInfo("cron_tick_sent", { reminderId: reminder.id, chatId: reminder.chatId });
    } catch (error) {
      logError("cron_tick_send_failed", error, { reminderId: reminder.id, chatId: reminder.chatId });
      await prisma.reminder.updateMany({
        where: {
          id: reminder.id,
          status: "sent",
          sentAt,
        },
        data: {
          status: "scheduled",
          sentAt: null,
        },
      });
    }
  }

  logInfo("cron_tick_done", { trigger, sentCount });
  return { dueCount: dueReminders.length, sentCount };
}

async function processTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (typeof update.update_id !== "number") {
    return;
  }

  const extracted = extractUserInput(update);
  if (!extracted) {
    return;
  }

  logInfo("telegram_update", {
    updateId: update.update_id,
    chatId: extracted.chatId,
    type: extracted.type,
    textPreview: (extracted.userText ?? "").slice(0, 120),
  });

  const inserted = await markUpdateProcessed(update.update_id);
  if (!inserted) {
    logInfo("telegram_update_duplicate", { updateId: update.update_id });
    return;
  }

  if (!extracted.userText) {
    await sendTelegramMessage(telegramBotToken, extracted.chatId, buildMissingTextReply());
    return;
  }

  const normalizedText = normalizeCommandText(extracted.userText);
  if (normalizedText === "/help") {
    await sendTelegramMessage(
      telegramBotToken,
      extracted.chatId,
      [
        "Команды:",
        "• Что сегодня",
        "• Все задачи",
        "• Коробка",
        "• /today /all /box",
        "• /tick (только владелец)",
      ].join("\n")
    );
    return;
  }

  if (normalizedText === "/tick") {
    if (!ownerChatId || extracted.chatId !== ownerChatId) {
      await sendTelegramMessage(telegramBotToken, extracted.chatId, "Команда недоступна.");
      return;
    }
    const result = await runCronTick("owner");
    await sendTelegramMessage(telegramBotToken, extracted.chatId, `tick ok: sent ${result.sentCount}`);
    return;
  }

  if (normalizedText === "коробка" || normalizedText === "/box") {
    await sendBoxView(extracted.chatId);
    return;
  }

  if (normalizedText === "все задачи" || normalizedText === "/all") {
    await sendAllFutureView(extracted.chatId);
    return;
  }

  if (normalizedText === "что сегодня" || normalizedText === "/today") {
    await sendTodayView(extracted.chatId);
    return;
  }

  const parsed = parseReminderCommand(extracted.userText);
  if (!parsed.ok) {
    logInfo("parse_failed", {
      reason: parsed.reason,
      textPreview: extracted.userText.slice(0, 120),
    });

    if (parsed.reason === "missing_date") {
      await sendTelegramMessage(telegramBotToken, extracted.chatId, buildMissingDateReply());
      return;
    }

    await sendTelegramMessage(telegramBotToken, extracted.chatId, buildParseFailedReply());
    return;
  }

  const reminder = await prisma.reminder.create({
    data: {
      chatId: extracted.chatId,
      text: parsed.value.text,
      remindAt: parsed.value.remindAt,
      status: "scheduled",
    },
  });

  await sendTelegramMessage(
    telegramBotToken,
    extracted.chatId,
    [
      buildConfirmationReply(parsed.value.remindDateLabel, parsed.value.remindTimeLabel, parsed.value.text),
      !cronSecret ? "Напоминания заработают после включения cron (см. /help)." : "",
    ].filter(Boolean).join("\n")
  );

  logInfo("reminder_created", {
    chatId: extracted.chatId,
    reminderId: reminder.id,
    remindAtMsk: `${parsed.value.remindDateLabel} ${parsed.value.remindTimeLabel}`,
    textPreview: parsed.value.text.slice(0, 120),
    timezone: MOSCOW_TIMEZONE,
  });
}

function isAuthorized(req: Request): boolean {
  if (!cronSecret) return false;
  return req.header("authorization") === `Bearer ${cronSecret}`;
}

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

app.post("/telegram/webhook", (req: Request, res: Response) => {
  res.status(200).json({ ok: true });

  const update = req.body as TelegramUpdate;
  void processTelegramUpdate(update).catch((error) => {
    logError("telegram_webhook_process_failed", error);
  });
});

app.post("/cron/tick", async (req: Request, res: Response) => {
  if (!cronSecret) {
    res.status(503).json({ error: "CRON_SECRET is not configured" });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const result = await runCronTick("http");
    res.status(200).json({ ok: true, due: result.dueCount, sent: result.sentCount });
  } catch (error) {
    logError("cron_tick_failed", error);
    res.status(500).json({ ok: false, error: "tick_failed" });
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: () => void) => {
  logError("unhandled_request_error", error);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(port, () => {
  logInfo("server_started", { port, mode: "reminder_bot" });
});
