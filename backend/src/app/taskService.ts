import { Prisma, Task, TaskStatus } from "@prisma/client";
import { addMinutes } from "date-fns";
import { parseTaskSpec } from "./parser";
import { prisma } from "./prisma";
import { formatMskDateTime, formatMskTime, rangeUtcForDayKey, todayRangeUtc } from "./time";

export interface RenderTask {
  id: string;
  line: string;
  status: TaskStatus;
}

const STATUS_TITLE: Record<TaskStatus, string> = {
  active: "Активные",
  boxed: "В коробке",
  completed: "Выполненные",
  canceled: "Отмененные",
};

function importancePrefix(important: boolean): string {
  return important ? "!" : "";
}

export function renderTaskLine(task: Task): string {
  const important = importancePrefix(task.important);
  if (task.dueAt) {
    return `• ${formatMskTime(task.dueAt)} ${important}${task.text}`;
  }
  return `• ${important}${task.text}`;
}

export async function createTaskFromText(chatId: string, text: string): Promise<{ reply: string; task?: Task }> {
  const spec = parseTaskSpec(text);
  if (spec.askReminderClarification) {
    return { reply: "Укажите дату и время для напоминаний, например: \"завтра 10:00\"." };
  }

  const status: TaskStatus = spec.dueAt ? "active" : "boxed";
  const task = await prisma.task.create({
    data: {
      chatId,
      text: spec.text,
      important: spec.important,
      emoji: "",
      status,
      dueAt: spec.dueAt,
      remindEveryMinutes: spec.remindEveryMinutes,
      nextReminderAt: spec.dueAt && spec.remindEveryMinutes ? spec.dueAt : null,
    },
  });

  return {
    task,
    reply: [
      "Задача создана:",
      renderTaskLine(task),
      task.remindEveryMinutes ? `Напоминать каждые ${task.remindEveryMinutes} мин.` : "",
    ].filter(Boolean).join("\n"),
  };
}

export async function listAllTasks(chatId: string): Promise<Record<TaskStatus, Task[]>> {
  const tasks = await prisma.task.findMany({
    where: { chatId },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
  });
  return {
    active: tasks.filter((t) => t.status === "active"),
    boxed: tasks.filter((t) => t.status === "boxed"),
    completed: tasks.filter((t) => t.status === "completed"),
    canceled: tasks.filter((t) => t.status === "canceled"),
  };
}

export async function listTodayTasks(chatId: string): Promise<{ active: Task[]; boxed: Task[] }> {
  const range = todayRangeUtc();
  const tasks = await prisma.task.findMany({
    where: {
      chatId,
      dueAt: { gte: range.from, lte: range.to },
      status: { in: ["active", "boxed"] },
    },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });
  return {
    active: tasks.filter((t) => t.status === "active"),
    boxed: tasks.filter((t) => t.status === "boxed"),
  };
}

export async function findTaskForChat(chatId: string, taskId: string): Promise<Task | null> {
  return prisma.task.findFirst({ where: { id: taskId, chatId } });
}

export async function markDone(chatId: string, taskId: string): Promise<string> {
  const task = await findTaskForChat(chatId, taskId);
  if (!task) return "Задача не найдена.";
  if (task.status === "completed") return "Уже выполнено.";
  if (task.status === "canceled") return "Уже отменено.";
  await prisma.task.update({
    where: { id: task.id },
    data: { status: "completed", completedAt: new Date(), nextReminderAt: null },
  });
  return "Готово, отмечено как выполнено.";
}

export async function cancelTask(chatId: string, taskId: string): Promise<string> {
  const task = await findTaskForChat(chatId, taskId);
  if (!task) return "Задача не найдена.";
  if (task.status === "canceled") return "Уже отменено.";
  if (task.status === "completed") return "Уже выполнено.";
  await prisma.task.update({
    where: { id: task.id },
    data: { status: "canceled", canceledAt: new Date(), nextReminderAt: null },
  });
  return "Задача отменена.";
}

export async function boxTask(chatId: string, taskId: string): Promise<string> {
  const task = await findTaskForChat(chatId, taskId);
  if (!task) return "Задача не найдена.";
  if (task.status === "boxed") return "Уже в коробке.";
  if (task.status === "completed") return "Уже выполнено.";
  if (task.status === "canceled") return "Уже отменено.";
  await prisma.task.update({
    where: { id: task.id },
    data: { status: "boxed", nextReminderAt: null },
  });
  return "Переместил в коробку.";
}

export async function activateTask(chatId: string, taskId: string): Promise<string> {
  const task = await findTaskForChat(chatId, taskId);
  if (!task) return "Задача не найдена.";
  if (task.status === "active") return "Уже активна.";
  if (task.status === "completed") return "Уже выполнено.";
  if (task.status === "canceled") return "Уже отменено.";
  if (!task.dueAt) return "Нужны дата/время для активации. Укажите новую задачу с дедлайном.";

  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: "active",
      nextReminderAt: task.remindEveryMinutes ? task.dueAt : null,
    },
  });
  return "Активировал задачу.";
}

export function allStatusTitles(): Array<[TaskStatus, string]> {
  return (["active", "boxed", "completed", "canceled"] as TaskStatus[]).map((status) => [status, STATUS_TITLE[status]]);
}

export async function fetchDueReminderBatch(limit = 50): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      status: "active",
      nextReminderAt: { lte: new Date() },
      remindEveryMinutes: { not: null },
    },
    orderBy: { nextReminderAt: "asc" },
    take: limit,
  });
}

export async function tryCreateSentReminder(taskId: string, scheduledAt: Date): Promise<boolean> {
  try {
    await prisma.sentReminder.create({
      data: { taskId, scheduledAt },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return false;
    }
    throw err;
  }
}

export async function advanceNextReminder(task: Task): Promise<void> {
  if (!task.remindEveryMinutes || !task.nextReminderAt) {
    await prisma.task.update({ where: { id: task.id }, data: { nextReminderAt: null } });
    return;
  }
  await prisma.task.update({
    where: { id: task.id },
    data: { nextReminderAt: addMinutes(task.nextReminderAt, task.remindEveryMinutes) },
  });
}

export async function listTodayActiveForDigest(chatId: string): Promise<{ active: Task[]; boxedCount: number }> {
  const range = todayRangeUtc();
  const [active, boxedCount] = await Promise.all([
    prisma.task.findMany({
      where: {
        chatId,
        status: "active",
        dueAt: { gte: range.from, lte: range.to },
      },
      orderBy: { dueAt: "asc" },
      take: 10,
    }),
    prisma.task.count({ where: { chatId, status: "boxed" } }),
  ]);
  return { active, boxedCount };
}

export async function listChatsWithTasks(): Promise<string[]> {
  const rows = await prisma.task.findMany({
    distinct: ["chatId"],
    select: { chatId: true },
  });
  return rows.map((x) => x.chatId);
}

export function isAllListRequest(text: string): boolean {
  const v = text.toLowerCase();
  return /(все задачи|весь список|список задач)/i.test(v);
}

export function isTodayListRequest(text: string): boolean {
  const v = text.toLowerCase();
  return /(список задач на сегодня|задачи сегодня|на сегодня)/i.test(v) && !/(сегодня\s+\d{1,2}:\d{2})/i.test(v);
}

export function formatReminderText(task: Task): string {
  const dueLabel = task.dueAt ? formatMskDateTime(task.dueAt) : "без времени";
  const every = task.remindEveryMinutes ? `каждые ${task.remindEveryMinutes} мин` : "без повтора";
  const title = task.dueAt
    ? `• ${formatMskTime(task.dueAt)} ${importancePrefix(task.important)}${task.text}`
    : `• ${importancePrefix(task.important)}${task.text}`;
  return `${title}\n${dueLabel} • ${every}`;
}

export function formatTodayDigest(active: Task[], boxedCount: number): string {
  const lines = active.length
    ? active.map((task) => renderTaskLine(task))
    : ["Сегодня активных задач нет."];
  const boxedInfo = boxedCount > 0 ? `\nВ коробке: ${boxedCount}` : "";
  return `Сводка на сегодня\n\n${lines.join("\n")}${boxedInfo}`;
}

export async function listTasksDebug(chatId: string): Promise<Task[]> {
  return prisma.task.findMany({ where: { chatId }, orderBy: [{ status: "asc" }, { dueAt: "asc" }] });
}

export function dayRangeByKey(dayKey: string): { from: Date; to: Date } {
  return rangeUtcForDayKey(dayKey);
}
