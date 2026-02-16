import {
  AppointmentKind,
  AppointmentStatus,
  PrismaClient,
  TherapistSettings,
} from "@prisma/client";
import { addDays, addHours, endOfDay, startOfDay } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { parseTaskFromTranscript, normalizeClientName } from "./taskParser";
import { TherapistAction } from "./therapistNlu";
import { computeAvailabilitySlots, type WorkingSettings } from "./scheduling";

const chronoRu = require("chrono-node/ru") as {
  parseDate: (text: string) => Date | null;
};

export interface InlineButton {
  text: string;
  callbackData: string;
}

export interface ActionResult {
  text: string;
  buttons?: InlineButton[];
}

const SLOT_KEYWORDS_RE = /(свободн\w*\s+слот|слоты|окна|когда\s+можно|подбери\s+слот|предложи\s+слот)/i;
const CREATE_VERBS_RE = /(запиши|запис[ьа]ть|создай\s+запись|поставь\s+запись|назначь\s+встречу)/i;

function looksLikeSuggestSlotsRequest(text: string): boolean {
  return SLOT_KEYWORDS_RE.test(text);
}

function hasExplicitCreateVerb(text: string): boolean {
  return CREATE_VERBS_RE.test(text);
}

function parseDateLike(value: string | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const byIso = new Date(trimmed);
  if (!Number.isNaN(byIso.getTime())) {
    return byIso;
  }

  const byRu = chronoRu.parseDate(trimmed);
  if (byRu && !Number.isNaN(byRu.getTime())) {
    return byRu;
  }

  return null;
}

function mapActionType(type: TherapistAction["type"]): AppointmentKind {
  if (type === "homework") return AppointmentKind.homework;
  if (type === "admin") return AppointmentKind.admin;
  if (type === "other") return AppointmentKind.other;
  return AppointmentKind.session;
}

export function defaultSettings(chatId: string | null): Omit<TherapistSettings, "id" | "createdAt" | "updatedAt"> {
  return {
    telegramChatId: chatId ?? "unknown",
    timezone: process.env.TZ?.trim() || "Asia/Bangkok",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    workStart: "10:00",
    workEnd: "18:00",
    sessionMinutes: 50,
    bufferMinutes: 10,
  };
}

export async function ensureSettings(prisma: PrismaClient, chatId: string): Promise<TherapistSettings> {
  const existing = await prisma.therapistSettings.findUnique({ where: { telegramChatId: chatId } });
  if (existing) return existing;
  const defaults = defaultSettings(chatId);
  return prisma.therapistSettings.create({ data: defaults });
}

export async function getSettings(prisma: PrismaClient, chatId?: string | null): Promise<TherapistSettings | null> {
  if (chatId) {
    const byChat = await prisma.therapistSettings.findUnique({ where: { telegramChatId: chatId } });
    if (byChat) return byChat;
  }
  return prisma.therapistSettings.findFirst({ orderBy: { createdAt: "asc" } });
}

async function resolveClient(prisma: PrismaClient, clientName?: string): Promise<{ id: string; displayName: string } | null> {
  if (!clientName || !clientName.trim()) return null;
  const displayName = clientName.trim();
  const normalizedName = normalizeClientName(displayName);
  if (!normalizedName) return null;
  const client = await prisma.client.upsert({
    where: { normalizedName },
    update: { displayName },
    create: { displayName, normalizedName },
    select: { id: true, displayName: true },
  });
  return client;
}

function asWorkingSettings(settings: TherapistSettings): WorkingSettings {
  return {
    timezone: settings.timezone,
    workDays: settings.workDays,
    workStart: settings.workStart,
    workEnd: settings.workEnd,
    sessionMinutes: settings.sessionMinutes,
    bufferMinutes: settings.bufferMinutes,
  };
}

function parseRange(action: TherapistAction): { from: Date; to: Date; limit: number } {
  const now = new Date();
  const limit = Math.max(1, Math.min(20, Number(action.limit) || 8));

  if (action.range === "today") {
    return { from: startOfDay(now), to: endOfDay(now), limit };
  }
  if (action.range === "tomorrow") {
    const d = addDays(now, 1);
    return { from: startOfDay(d), to: endOfDay(d), limit };
  }
  if (action.range === "this_week") {
    return { from: startOfDay(now), to: endOfDay(addDays(now, 6)), limit };
  }
  if (action.range === "next_week") {
    const from = startOfDay(addDays(now, 7));
    return { from, to: endOfDay(addDays(from, 6)), limit };
  }

  const from = parseDateLike(action.from) ?? startOfDay(now);
  const to = parseDateLike(action.to) ?? endOfDay(addDays(now, 6));
  return { from, to, limit };
}

function formatSlot(startAt: Date, endAt: Date, timezone: string): string {
  const start = formatInTimeZone(startAt, timezone, "dd.MM HH:mm");
  const end = formatInTimeZone(endAt, timezone, "HH:mm");
  return `${start}–${end}`;
}

function hasExplicitTimeHint(value: string): boolean {
  return /(\d{1,2}:\d{2}|\d{1,2}\.\d{2}|\d{1,2}\s*час)/i.test(value);
}

export async function executeTherapistAction(params: {
  prisma: PrismaClient;
  action: TherapistAction;
  originalText: string;
  chatId?: string | null;
}): Promise<ActionResult> {
  const { prisma, originalText, chatId } = params;
  let action = params.action;

  if (
    action.intent === "create_appointment" &&
    looksLikeSuggestSlotsRequest(originalText) &&
    !hasExplicitCreateVerb(originalText)
  ) {
    action = {
      ...action,
      intent: "suggest_slots",
      confidenceOrReason:
        "executor_guard:create_appointment->suggest_slots(slot_keywords_without_explicit_create_verb)",
    };
  }

  if (action.intent === "set_working_hours") {
    if (!chatId) {
      return { text: "Не вижу чат для сохранения расписания." };
    }
    const settings = await ensureSettings(prisma, chatId);
    const nextDays =
      action.days_of_week && action.days_of_week.length > 0 ? action.days_of_week : settings.workDays;
    const nextStart = action.start_time || settings.workStart;
    const nextEnd = action.end_time || settings.workEnd;
    const nextTz = action.timezone || settings.timezone;

    await prisma.therapistSettings.update({
      where: { id: settings.id },
      data: {
        workDays: nextDays,
        workStart: nextStart,
        workEnd: nextEnd,
        timezone: nextTz,
      },
    });

    return {
      text: `Сделал: рабочее расписание обновлено (${nextDays.join(", ")}, ${nextStart}-${nextEnd}, ${nextTz}).`,
    };
  }

  if (action.intent === "create_appointment") {
    const client = await resolveClient(prisma, action.client_name);
    if (!client) {
      return { text: "Не смог определить клиента для записи." };
    }

    const startAt = parseDateLike(action.start_datetime) ?? parseTaskFromTranscript(originalText).deadline;
    if (!startAt) {
      return { text: "Не смог определить время записи." };
    }

    const settings = (await getSettings(prisma, chatId)) ?? (await ensureSettings(prisma, chatId || "default"));
    const endAt = new Date(startAt.getTime() + settings.sessionMinutes * 60_000);

    await prisma.appointment.create({
      data: {
        clientId: client.id,
        startAt,
        endAt,
        kind: mapActionType(action.type),
        status: AppointmentStatus.planned,
        notes: action.notes?.trim() || null,
      },
    });

    return {
      text: `Сделал: запись для ${client.displayName} на ${formatSlot(startAt, endAt, settings.timezone)} создана.`,
    };
  }

  if (action.intent === "suggest_slots") {
    const client = await resolveClient(prisma, action.client_name);
    if (!client) {
      return { text: "Не смог определить клиента для подбора слотов." };
    }

    const settings = (await getSettings(prisma, chatId)) ?? (await ensureSettings(prisma, chatId || "default"));
    const range = parseRange(action);
    const busy = await prisma.appointment.findMany({
      where: {
        status: { not: AppointmentStatus.canceled },
        startAt: { gte: range.from, lte: range.to },
      },
      select: { startAt: true, endAt: true },
      orderBy: { startAt: "asc" },
    });

    const slots = computeAvailabilitySlots({
      from: range.from,
      to: range.to,
      settings: asWorkingSettings(settings),
      appointments: busy,
      limit: range.limit,
    });

    if (!slots.length) {
      return { text: `Сделал: не нашел свободных слотов для ${client.displayName} в выбранном периоде.` };
    }

    return {
      text: `Сделал: нашел свободные слоты для ${client.displayName}. Выберите вариант:`,
      buttons: slots.map((slot) => ({
        text: formatSlot(slot.startAt, slot.endAt, settings.timezone),
        callbackData: `slot|${client.id}|${slot.startAt.getTime()}`,
      })),
    };
  }

  if (action.intent === "cancel_appointment") {
    const settings = (await getSettings(prisma, chatId)) ?? (await ensureSettings(prisma, chatId || "default"));
    const where: {
      status: AppointmentStatus;
      startAt?: { gte?: Date; lte?: Date };
      client?: { normalizedName: string };
    } = { status: AppointmentStatus.planned };

    if (action.client_name) {
      const normalizedName = normalizeClientName(action.client_name);
      if (normalizedName) {
        where.client = { normalizedName };
      }
    }

    if (action.target === "next_appointment") {
      where.startAt = { gte: new Date() };
    } else if (action.datetime_hint) {
      const hintDate = parseDateLike(action.datetime_hint);
      if (hintDate) {
        where.startAt = hasExplicitTimeHint(action.datetime_hint)
          ? { gte: addHours(hintDate, -2), lte: addHours(hintDate, 2) }
          : { gte: startOfDay(hintDate), lte: endOfDay(hintDate) };
      }
    } else if (action.date) {
      const dateOnly = parseDateLike(action.date);
      if (dateOnly) {
        where.startAt = { gte: startOfDay(dateOnly), lte: endOfDay(dateOnly) };
      }
    }

    const candidates = await prisma.appointment.findMany({
      where,
      include: { client: { select: { displayName: true } } },
      orderBy: { startAt: "asc" },
      take: 8,
    });

    if (!candidates.length) {
      return { text: "Сделал: подходящая запись для отмены не найдена." };
    }

    if (candidates.length === 1) {
      const single = candidates[0];
      await prisma.appointment.update({
        where: { id: single.id },
        data: { status: AppointmentStatus.canceled },
      });
      return {
        text: `Сделал: запись отменена — ${single.client.displayName} ${formatSlot(
          single.startAt,
          single.endAt,
          settings.timezone
        )}.`,
      };
    }

    return {
      text: "Сделал: нашел несколько подходящих записей. Выберите, какую отменить:",
      buttons: [
        ...candidates.map((candidate) => ({
          text: `${formatSlot(candidate.startAt, candidate.endAt, settings.timezone)} — ${candidate.client.displayName}`,
          callbackData: `cancel_pick|${candidate.id}`,
        })),
        { text: "Отмена", callbackData: "cancel_no|0" },
      ],
    };
  }

  if (action.intent === "mark_done") {
    const where: {
      status: AppointmentStatus;
      client?: { normalizedName: string };
    } = { status: AppointmentStatus.planned };

    if (action.client_name) {
      const normalizedName = normalizeClientName(action.client_name);
      if (normalizedName) where.client = { normalizedName };
    }

    const candidate = await prisma.appointment.findFirst({
      where,
      orderBy: { startAt: "asc" },
    });

    if (!candidate) {
      return { text: "Сделал: запись для завершения не найдена." };
    }

    await prisma.appointment.update({
      where: { id: candidate.id },
      data: { status: AppointmentStatus.done },
    });

    return { text: "Сделал: запись отмечена как завершенная." };
  }

  if (action.intent === "daily_agenda") {
    return { text: "Сделал: используйте /cron/daily для отправки повестки в чат." };
  }

  return { text: "Не понял команду. Скажите по-другому." };
}
