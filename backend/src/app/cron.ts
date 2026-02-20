import { Task } from "@prisma/client";
import type { Telegraf } from "telegraf";
import {
  advanceNextReminder,
  cleanupCompletedOverflow,
  fetchDueReminderBatch,
  formatReminderText,
  formatTodayDigest,
  listChatsWithTasks,
  listTodayActiveForDigest,
  tryCreateSentReminder,
} from "./taskService";
import { logError, logInfo } from "./logger";

function reminderKeyboard(taskId: string) {
  return {
    inline_keyboard: [[
      { text: "✅ Выполнено", callback_data: `done:${taskId}` },
      { text: "❌ Отменить", callback_data: `cancel:${taskId}` },
      { text: "📥 Отложить в коробку", callback_data: `box:${taskId}` },
    ]],
  };
}

export async function runCronTick(bot: Telegraf): Promise<{ processed: number }> {
  await cleanupCompletedOverflow(15);
  const tasks = await fetchDueReminderBatch(100);
  let processed = 0;

  for (const task of tasks) {
    if (!task.nextReminderAt) continue;
    const unique = await tryCreateSentReminder(task.id, task.nextReminderAt);
    if (!unique) continue;
    await bot.telegram.sendMessage(task.chatId, `Напоминание\n${formatReminderText(task)}`, {
      reply_markup: reminderKeyboard(task.id),
    });
    await advanceNextReminder(task as Task);
    processed += 1;
  }

  logInfo("cron_tick_done", { processed });
  return { processed };
}

export async function runDailyDigest(bot: Telegraf): Promise<{ delivered: number }> {
  const chats = await listChatsWithTasks();
  let delivered = 0;

  for (const chatId of chats) {
    try {
      const { active, boxedCount } = await listTodayActiveForDigest(chatId);
      await bot.telegram.sendMessage(chatId, formatTodayDigest(active, boxedCount));
      if (active.length > 0) {
        const rows = active.slice(0, 10).map((task) => ([
          { text: "✅", callback_data: `done:${task.id}` },
          { text: "❌", callback_data: `cancel:${task.id}` },
        ]));
        await bot.telegram.sendMessage(chatId, "Быстрые действия:", { reply_markup: { inline_keyboard: rows } });
      }
      delivered += 1;
    } catch (err) {
      logError("daily_digest_chat_failed", err, { chatId });
    }
  }

  logInfo("cron_daily_done", { delivered });
  return { delivered };
}
