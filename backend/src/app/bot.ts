import { Task } from "@prisma/client";
import { Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { AppConfig } from "./config";
import { logError } from "./logger";
import {
  activateTask,
  allStatusTitles,
  boxTask,
  cancelTask,
  createTaskFromText,
  isAllListRequest,
  isTodayListRequest,
  listAllTasks,
  listTodayTasks,
  markDone,
  renderTaskLine,
} from "./taskService";
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

async function sendAllList(ctx: Context, chatId: string): Promise<void> {
  const grouped = await listAllTasks(chatId);
  await ctx.reply("🗂 Весь список задач");
  for (const [status, title] of allStatusTitles()) {
    const items = grouped[status];
    if (!items.length) continue;
    await ctx.reply(`${title} (${items.length})`);
    for (const task of items.slice(0, 30)) {
      await ctx.reply(renderTaskLine(task), { reply_markup: taskKeyboard(task) });
    }
  }
}

async function sendTodayList(ctx: Context, chatId: string): Promise<void> {
  const today = await listTodayTasks(chatId);
  await ctx.reply("📋 Задачи на сегодня");
  if (today.active.length === 0 && today.boxed.length === 0) {
    await ctx.reply("На сегодня задач нет.");
    return;
  }
  for (const task of today.active) {
    await ctx.reply(renderTaskLine(task), { reply_markup: taskKeyboard(task) });
  }
  if (today.boxed.length > 0) {
    await ctx.reply("📥 В коробке:");
    for (const task of today.boxed) {
      await ctx.reply(renderTaskLine(task), { reply_markup: taskKeyboard(task) });
    }
  }
}

function getChatId(ctx: Context): string | null {
  const c = (ctx as unknown as { chat?: { id?: string | number } }).chat;
  if (!c || c.id == null) return null;
  return String(c.id);
}

async function handleTextIntent(ctx: Context, chatId: string, text: string): Promise<void> {
  if (isAllListRequest(text)) {
    await sendAllList(ctx, chatId);
    return;
  }
  if (isTodayListRequest(text)) {
    await sendTodayList(ctx, chatId);
    return;
  }
  const created = await createTaskFromText(chatId, text);
  await ctx.reply(created.reply);
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
    await ctx.reply(
      [
        "Привет! Я Telegram Scheduler.",
        "Пример: Сделать отчет завтра 10:00, напоминай каждые 3 часа",
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "📋 Сегодня", callback_data: "today:list" },
            { text: "🗂 Все задачи", callback_data: "all:list" },
          ]],
        },
      }
    );
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

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Команды:",
        "/today — задачи на сегодня",
        "/all — все задачи",
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
        await ctx.reply("Голос временно недоступен: не настроен OPENROUTER_API_KEY. Текст работает.");
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
      await safeReply(ctx, "Не удалось обработать голос. Попробуйте текстом.");
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
      await safeReply(ctx, "Ошибка обработки команды. Попробуйте позже.");
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

      const [action, taskId] = data.split(":");
      if (!taskId) return;
      if (action === "done") {
        await safeReply(ctx, await markDone(chatId, taskId));
        return;
      }
      if (action === "cancel") {
        await safeReply(ctx, await cancelTask(chatId, taskId));
        return;
      }
      if (action === "box") {
        await safeReply(ctx, await boxTask(chatId, taskId));
        return;
      }
      if (action === "activate") {
        await safeReply(ctx, await activateTask(chatId, taskId));
      }
    } catch (err) {
      logError("callback_failed", err, { chatId, data });
      await safeReply(ctx, "Не удалось обработать действие.");
    }
  });

  return bot;
}
