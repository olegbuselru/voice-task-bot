import { Task } from "@prisma/client";
import { Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { AppConfig } from "./config";
import { logError } from "./logger";
import {
  activateTask,
  boxTask,
  cancelTask,
  countBoxedTasks,
  createTaskFromText,
  isBoxListRequest,
  isDoneListRequest,
  isAllListRequest,
  isTodayListRequest,
  listActiveTasks,
  listBoxedTasks,
  listRecentCompleted,
  listTodayTasks,
  markDone,
  renderTaskLine,
} from "./taskService";
import { parseDueDateMsk } from "./time";
import { transcribeVoiceFromTelegram } from "./voice";

function taskKeyboard(task: Task) {
  if (task.status === "boxed") {
    return {
      inline_keyboard: [[
        { text: "✅ Выполнено", callback_data: `done:${task.id}` },
        { text: "▶️ Активировать", callback_data: `activate:${task.id}` },
        { text: "❌ Отменить", callback_data: `cancel:${task.id}` },
      ]],
    };
  }
  return {
    inline_keyboard: [[
      { text: "✅ Выполнено", callback_data: `done:${task.id}` },
      { text: "❌ Отменить", callback_data: `cancel:${task.id}` },
      { text: "📥 Отложить в коробку", callback_data: `box:${task.id}` },
    ]],
  };
}

function homeKeyboard() {
  return {
    keyboard: [[
      { text: "Коробка" },
      { text: "Что сегодня" },
      { text: "Все задачи" },
    ]],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

async function sendWithHomeKeyboard(ctx: Context, text: string): Promise<void> {
  await ctx.reply(text, { reply_markup: homeKeyboard() });
}

function normalizeIntentText(text: string): string {
  return text.toLowerCase().replace(/[.,!?;:()"'`]/g, " ").replace(/\s+/g, " ").trim();
}

function hasDateTimeHint(text: string): boolean {
  return parseDueDateMsk(text) !== null;
}

async function sendAllList(ctx: Context, chatId: string): Promise<void> {
  const [active, boxedCount] = await Promise.all([listActiveTasks(chatId), countBoxedTasks(chatId)]);
  await sendWithHomeKeyboard(ctx, "Все задачи");
  if (!active.length) {
    await sendWithHomeKeyboard(ctx, "Активных задач нет.");
    return;
  }
  for (const task of active.slice(0, 30)) {
    await ctx.reply(renderTaskLine(task), { reply_markup: taskKeyboard(task) });
  }
  if (boxedCount > 0) {
    await sendWithHomeKeyboard(ctx, `В коробке: ${boxedCount}`);
  }
}

async function sendTodayList(ctx: Context, chatId: string): Promise<void> {
  const today = await listTodayTasks(chatId);
  await sendWithHomeKeyboard(ctx, "Что сегодня");
  if (today.active.length === 0) {
    await sendWithHomeKeyboard(ctx, "На сегодня задач нет.");
    return;
  }
  for (const task of today.active) {
    await ctx.reply(renderTaskLine(task), { reply_markup: taskKeyboard(task) });
  }
}

async function sendBoxedList(ctx: Context, chatId: string): Promise<void> {
  const boxed = await listBoxedTasks(chatId);
  await sendWithHomeKeyboard(ctx, "Коробка");
  if (!boxed.length) {
    await sendWithHomeKeyboard(ctx, "Коробка пуста.");
    return;
  }
  for (const task of boxed.slice(0, 30)) {
    await ctx.reply(renderTaskLine(task), { reply_markup: taskKeyboard(task) });
  }
}

async function sendDoneList(ctx: Context, chatId: string): Promise<void> {
  const done = await listRecentCompleted(chatId, 15);
  await sendWithHomeKeyboard(ctx, "Сделано");
  if (!done.length) {
    await sendWithHomeKeyboard(ctx, "Выполненных задач пока нет.");
    return;
  }
  const lines = done.map((task) => renderTaskLine(task));
  await sendWithHomeKeyboard(ctx, lines.join("\n"));
}

async function sendActionResult(ctx: Context, text: string): Promise<void> {
  await sendWithHomeKeyboard(ctx, text);
}

async function sendHomeHelp(ctx: Context): Promise<void> {
  await sendWithHomeKeyboard(
    ctx,
    [
      "Привет! Я Telegram Scheduler.",
      "Пример: Сделать отчет завтра 10:00, напоминай каждые 3 часа",
    ].join("\n")
  );
}

function shouldRouteToShortcut(text: string): boolean {
  return !hasDateTimeHint(text);
}

function normalizeForShortcuts(text: string): string {
  return normalizeIntentText(text);
}

function isAllShortcut(text: string): boolean {
  const v = normalizeForShortcuts(text);
  return isAllListRequest(v) || v === "все задачи" || v === "все";
}

function isTodayShortcut(text: string): boolean {
  const v = normalizeForShortcuts(text);
  return isTodayListRequest(v) || v === "что сегодня" || v === "сегодня";
}

function isBoxShortcut(text: string): boolean {
  const v = normalizeForShortcuts(text);
  return isBoxListRequest(v) || v === "коробка" || v === "инбокс";
}

function isDoneShortcut(text: string): boolean {
  const v = normalizeForShortcuts(text);
  return isDoneListRequest(v) || v === "сделано";
}

async function handleShortcutIntent(ctx: Context, chatId: string, text: string): Promise<boolean> {
  if (!shouldRouteToShortcut(text)) return false;

  if (isAllShortcut(text)) {
    await sendAllList(ctx, chatId);
    return true;
  }
  if (isTodayShortcut(text)) {
    await sendTodayList(ctx, chatId);
    return true;
  }
  if (isBoxShortcut(text)) {
    await sendBoxedList(ctx, chatId);
    return true;
  }
  if (isDoneShortcut(text)) {
    await sendDoneList(ctx, chatId);
    return true;
  }
  return false;
}

function getChatId(ctx: Context): string | null {
  const c = (ctx as unknown as { chat?: { id?: string | number } }).chat;
  if (!c || c.id == null) return null;
  return String(c.id);
}

async function handleTextIntent(ctx: Context, chatId: string, text: string): Promise<void> {
  if (await handleShortcutIntent(ctx, chatId, text)) {
    return;
  }
  const created = await createTaskFromText(chatId, text);
  await sendWithHomeKeyboard(ctx, created.reply);
  if (created.task) {
    await ctx.reply("Действия:", { reply_markup: taskKeyboard(created.task) });
  }
}

async function safeReply(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.reply(text);
  } catch {
    // ignore reply failures
  }
}

export function createBot(config: AppConfig): Telegraf {
  const bot = new Telegraf(config.telegramBotToken);

  bot.command("start", async (ctx) => {
    await sendHomeHelp(ctx);
  });

  bot.command("today", async (ctx) => {
    const chatId = getChatId(ctx);
    if (!chatId) return;
    await sendTodayList(ctx, chatId);
  });

  bot.command("all", async (ctx) => {
    const chatId = getChatId(ctx);
    if (!chatId) return;
    await sendAllList(ctx, chatId);
  });

  bot.command("box", async (ctx) => {
    const chatId = getChatId(ctx);
    if (!chatId) return;
    await sendBoxedList(ctx, chatId);
  });

  bot.command("done", async (ctx) => {
    const chatId = getChatId(ctx);
    if (!chatId) return;
    await sendDoneList(ctx, chatId);
  });

  bot.command("help", async (ctx) => {
    await sendWithHomeKeyboard(
      ctx,
      [
        "Команды:",
        "/today — задачи на сегодня",
        "/all — все задачи",
        "/box — коробка",
        "/done — сделано",
        "Пример: Сделать отчет завтра 10:00, напоминай каждые 3 часа",
      ].join("\n")
    );
  });

  bot.on(message("voice"), async (ctx) => {
    const chatId = getChatId(ctx);
    if (!chatId) return;
    try {
      const msg = ctx.message;
      if (!msg || !("voice" in msg) || !msg.voice) return;
      if (!config.openRouterApiKey) {
        await sendWithHomeKeyboard(ctx, "Голос временно недоступен: не настроен OPENROUTER_API_KEY. Текст работает.");
        return;
      }
      const text = await transcribeVoiceFromTelegram({
        telegram: bot.telegram,
        fileId: msg.voice.file_id,
        config,
      });
      await handleTextIntent(ctx, chatId, text);
    } catch (err) {
      logError("voice_handler_failed", err, { chatId });
      await sendWithHomeKeyboard(ctx, "Не удалось обработать голос. Попробуйте текстом.");
    }
  });

  bot.on(message("text"), async (ctx) => {
    const chatId = getChatId(ctx);
    if (!chatId) return;
    const text = ctx.message.text.trim();
    if (!text) return;
    try {
      await handleTextIntent(ctx, chatId, text);
    } catch (err) {
      logError("text_handler_failed", err, { chatId, text });
      await sendWithHomeKeyboard(ctx, "Ошибка обработки команды. Попробуйте позже.");
    }
  });

  bot.on("callback_query", async (ctx) => {
    const callback = (ctx as unknown as { callbackQuery?: { data?: string } }).callbackQuery;
    const data = callback?.data;
    const chatId = getChatId(ctx);
    if (!data || !chatId) return;

    try {
      if (data === "today:list") {
        await sendTodayList(ctx, chatId);
        return;
      }
      if (data === "all:list") {
        await sendAllList(ctx, chatId);
        return;
      }
      if (data === "box:list") {
        await sendBoxedList(ctx, chatId);
        return;
      }

      const [action, taskId] = data.split(":");
      if (!taskId) return;
      if (action === "done") {
        await sendActionResult(ctx, await markDone(chatId, taskId));
        return;
      }
      if (action === "cancel") {
        await sendActionResult(ctx, await cancelTask(chatId, taskId));
        return;
      }
      if (action === "box") {
        await sendActionResult(ctx, await boxTask(chatId, taskId));
        return;
      }
      if (action === "activate") {
        await sendActionResult(ctx, await activateTask(chatId, taskId));
      }
    } catch (err) {
      logError("callback_failed", err, { chatId, data });
      await sendWithHomeKeyboard(ctx, "Не удалось обработать действие.");
    }
  });

  return bot;
}
