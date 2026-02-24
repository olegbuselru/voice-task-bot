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

function requireEnv(name: "TELEGRAM_BOT_TOKEN" | "CRON_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const port = Number(process.env.PORT || 3000);
const telegramBotToken = requireEnv("TELEGRAM_BOT_TOKEN");
const cronSecret = requireEnv("CRON_SECRET");

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
    buildConfirmationReply(parsed.value.remindDateLabel, parsed.value.remindTimeLabel, parsed.value.text)
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
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const dueReminders = await prisma.reminder.findMany({
      where: {
        status: "scheduled",
        remindAt: { lte: new Date() },
      },
      orderBy: { remindAt: "asc" },
      take: 100,
    });

    let sent = 0;

    for (const reminder of dueReminders) {
      await sendTelegramMessage(telegramBotToken, reminder.chatId, `🔔 Напоминание: ${reminder.text}`);

      const updated = await prisma.reminder.updateMany({
        where: {
          id: reminder.id,
          status: "scheduled",
        },
        data: {
          status: "sent",
          sentAt: new Date(),
        },
      });

      if (updated.count === 1) {
        sent += 1;
      }
    }

    logInfo("cron_tick_done", { due: dueReminders.length, sent });
    res.status(200).json({ ok: true, due: dueReminders.length, sent });
  } catch (error) {
    logError("cron_tick_failed", error);
    res.status(200).json({ ok: false, error: "tick_failed" });
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: () => void) => {
  logError("unhandled_request_error", error);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(port, () => {
  logInfo("server_started", { port, mode: "reminder_bot" });
});
