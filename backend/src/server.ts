import express, { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { createBot } from "./app/bot";
import { loadConfig } from "./app/config";
import { runCronTick, runDailyDigest } from "./app/cron";
import { logError, logInfo } from "./app/logger";
import { prisma } from "./app/prisma";
import { listTasksDebug } from "./app/taskService";
import { checkFfmpegAvailability } from "./app/voice";

const app = express();
app.use(express.json({ limit: "3mb" }));

const config = loadConfig();
const bot = createBot(config);

function unauthorized(res: Response): void {
  res.status(401).json({ error: "Unauthorized" });
}

function requireCronAuth(req: Request, res: Response): boolean {
  const auth = req.header("authorization") || "";
  const expected = `Bearer ${config.cronSecret}`;
  if (auth !== expected) {
    unauthorized(res);
    return false;
  }
  return true;
}

async function markProcessedUpdate(chatId: string, updateId: number): Promise<boolean> {
  try {
    await prisma.processedUpdate.create({
      data: {
        chatId,
        updateId,
      },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return false;
    }
    throw err;
  }
}

app.get("/", (_req, res) => {
  res.redirect("/health");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/tasks", async (req, res) => {
  const chatId = typeof req.query.chatId === "string" ? req.query.chatId : "";
  if (!chatId) {
    res.status(400).json({ error: "chatId is required" });
    return;
  }
  const rows = await listTasksDebug(chatId);
  res.json(rows);
});

app.post("/telegram/webhook", async (req, res) => {
  let fallbackChatId: string | null = null;
  try {
    const update = req.body as {
      update_id?: number;
      message?: {
        chat?: { id?: number | string };
        text?: string;
        voice?: { file_id?: string; duration?: number; mime_type?: string };
      };
      callback_query?: { message?: { chat?: { id?: number | string } } };
    };

    if (!update || typeof update.update_id !== "number") {
      res.status(400).json({ error: "invalid telegram update" });
      return;
    }

    const chatIdRaw = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
    const chatId = chatIdRaw != null ? String(chatIdRaw) : "unknown";
    fallbackChatId = chatId !== "unknown" ? chatId : null;
    const hasVoice = Boolean(update.message?.voice?.file_id);
    const messageType = hasVoice ? "voice" : update.message?.text ? "text" : "other";
    logInfo("telegram_update_received", {
      updateId: update.update_id,
      chatId,
      messageType,
      voiceFileId: update.message?.voice?.file_id,
      duration: update.message?.voice?.duration,
      mime: update.message?.voice?.mime_type,
    });

    const inserted = await markProcessedUpdate(chatId, update.update_id);
    if (!inserted) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    await bot.handleUpdate(update as never);
    res.status(200).json({ ok: true });
  } catch (err) {
    logError("telegram_webhook_failed", err);
    if (fallbackChatId) {
      try {
        await bot.telegram.sendMessage(fallbackChatId, "Не удалось обработать сообщение. Попробуй еще раз или отправь текстом.");
      } catch (sendErr) {
        logError("telegram_webhook_fallback_reply_failed", sendErr, { chatId: fallbackChatId });
      }
    }
    res.status(200).json({ ok: false });
  }
});

app.post("/cron/tick", async (req, res) => {
  if (!requireCronAuth(req, res)) return;
  try {
    const result = await runCronTick(bot);
    res.json({ ok: true, ...result });
  } catch (err) {
    logError("cron_tick_failed", err);
    res.status(500).json({ ok: false });
  }
});

app.post("/cron/daily", async (req, res) => {
  if (!requireCronAuth(req, res)) return;
  try {
    const result = await runDailyDigest(bot);
    res.json({ ok: true, ...result });
  } catch (err) {
    logError("cron_daily_failed", err);
    res.status(500).json({ ok: false });
  }
});

app.listen(config.port, () => {
  checkFfmpegAvailability();
  logInfo("server_started", { port: config.port });
});
