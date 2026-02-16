import { AppointmentStatus, PendingActionType, Prisma, PrismaClient, TherapistSettings } from "@prisma/client";
import { addDays, endOfDay, startOfDay, subDays } from "date-fns";
import { formatInTimeZone, zonedTimeToUtc } from "date-fns-tz";
import type { Context } from "telegraf";
import { computeAvailabilitySlots } from "./scheduling";
import { normalizeClientName } from "./taskParser";

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS: Record<(typeof DAY_ORDER)[number], string> = {
  mon: "Пн",
  tue: "Вт",
  wed: "Ср",
  thu: "Чт",
  fri: "Пт",
  sat: "Сб",
  sun: "Вс",
};

const TIME_START_OPTIONS = ["09:00", "10:00", "11:00", "12:00"];
const TIME_END_OPTIONS = ["17:00", "18:00", "19:00", "20:00"];
const TZ_OPTIONS = ["Asia/Bangkok", "Europe/Moscow", "UTC"];

type ScreenName = "home" | "today" | "week" | "day" | "settings" | "appointment_card" | "clients" | "new";

interface NewWizardPayload {
  step?: "client" | "day" | "time" | "confirm";
  clientId?: string;
  clientName?: string;
  dayIso?: string;
  selectedPendingId?: string;
  slotOptions?: Array<{ pendingId: string; label: string }>;
}

interface ScreenRenderResult {
  screen: ScreenName;
  step: string;
  text: string;
  keyboard: Array<Array<{ text: string; callback_data: string }>>;
  payload?: Record<string, unknown>;
  weekAnchor?: Date;
  dayIso?: string;
}

function asWorkingSettings(settings: TherapistSettings) {
  return {
    timezone: safeTimezone(settings),
    workDays: settings.workDays,
    workStart: settings.workStart,
    workEnd: settings.workEnd,
    sessionMinutes: settings.sessionMinutes,
    bufferMinutes: settings.bufferMinutes,
  };
}

function parsePageNumber(raw: string | undefined, fallback = 1): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function slotsFromPayload(payload: NewWizardPayload): Array<{ pendingId: string; label: string }> {
  if (!Array.isArray(payload.slotOptions)) return [];
  return payload.slotOptions.filter(
    (slot): slot is { pendingId: string; label: string } => !!slot && typeof slot.pendingId === "string" && typeof slot.label === "string"
  );
}

interface RenderParams {
  prisma: PrismaClient;
  ctx: Context;
  chatId: string;
  screen: ScreenName;
  step?: string;
  payload?: Record<string, unknown>;
  weekAnchor?: Date | null;
  dayIso?: string | null;
  preferredMessageId?: string | null;
}

function shortClientName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words[0] || name;
  return `${words[0]} ${words[1][0]}.`;
}

function statusBadge(status: AppointmentStatus): string {
  if (status === AppointmentStatus.done) return "✅ done";
  if (status === AppointmentStatus.canceled) return "⛔ canceled";
  return "🟦 planned";
}

function safeTimezone(settings: TherapistSettings): string {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: settings.timezone });
    return settings.timezone;
  } catch {
    return "Asia/Bangkok";
  }
}

function isoDayInTz(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

function rangeForIsoDay(dayIso: string, timezone: string): { from: Date; to: Date } {
  return {
    from: zonedTimeToUtc(`${dayIso}T00:00:00`, timezone),
    to: zonedTimeToUtc(`${dayIso}T23:59:59`, timezone),
  };
}

function hhmm(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "HH:mm");
}

function dayTitle(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "EEE dd LLL");
}

function normalizeDateInput(text: string, timezone: string): string | null {
  const value = text.trim().toLowerCase();
  if (value === "сегодня") return isoDayInTz(new Date(), timezone);
  if (value === "завтра") return isoDayInTz(addDays(new Date(), 1), timezone);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dm = value.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (dm) {
    const year = Number(formatInTimeZone(new Date(), timezone, "yyyy"));
    const month = dm[2].padStart(2, "0");
    const day = dm[1].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

function isValidHHMM(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

function ensureHoursOrder(start: string, end: string): boolean {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  return endMin - startMin >= 60;
}

async function ensureState(prisma: PrismaClient, chatId: string) {
  return prisma.conversationState.upsert({
    where: { chatId },
    update: {},
    create: {
      chatId,
      screen: "home",
      step: "idle",
      payloadJson: {},
    },
  });
}

async function getChatSettings(prisma: PrismaClient, chatId: string): Promise<TherapistSettings | null> {
  return prisma.therapistSettings.findUnique({ where: { telegramChatId: chatId } });
}

async function buildDaySlotOptions(params: {
  prisma: PrismaClient;
  chatId: string;
  clientId: string;
  dayIso: string;
}): Promise<{
  clientId: string;
  clientName: string;
  dayIso: string;
  timezone: string;
  slotOptions: Array<{ pendingId: string; label: string }>;
} | null> {
  const { prisma, chatId, clientId, dayIso } = params;
  const [settings, client] = await Promise.all([
    getChatSettings(prisma, chatId),
    prisma.client.findUnique({ where: { id: clientId } }),
  ]);
  if (!settings || !client) return null;

  const timezone = safeTimezone(settings);
  const range = rangeForIsoDay(dayIso, timezone);
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
    limit: 8,
  });

  const slotOptions: Array<{ pendingId: string; label: string }> = [];
  for (const slot of slots) {
    const pending = await prisma.pendingAction.create({
      data: {
        chatId,
        type: PendingActionType.pick_slot,
        payloadJson: {
          clientId: client.id,
          clientName: client.displayName,
          startAtIso: slot.startAt.toISOString(),
          endAtIso: slot.endAt.toISOString(),
        } as Prisma.InputJsonValue,
        expiresAt: addDays(new Date(), 1),
      },
    });
    slotOptions.push({ pendingId: pending.id, label: `${hhmm(slot.startAt, timezone)}-${hhmm(slot.endAt, timezone)}` });
  }

  return {
    clientId: client.id,
    clientName: client.displayName,
    dayIso,
    timezone,
    slotOptions,
  };
}

async function cleanupPending(prisma: PrismaClient, chatId: string): Promise<void> {
  await prisma.pendingAction.deleteMany({
    where: {
      chatId,
      expiresAt: { lt: new Date() },
    },
  });
}

async function upsertState(prisma: PrismaClient, chatId: string, patch: {
  screen: string;
  step: string;
  payloadJson?: Prisma.InputJsonValue;
  screenMessageId?: string | null;
  weekAnchor?: Date | null;
  dayIso?: string | null;
}) {
  await prisma.conversationState.upsert({
    where: { chatId },
    update: {
      screen: patch.screen,
      step: patch.step,
      payloadJson: patch.payloadJson,
      screenMessageId: patch.screenMessageId ?? undefined,
      weekAnchor: patch.weekAnchor ?? undefined,
      dayIso: patch.dayIso ?? undefined,
    },
    create: {
      chatId,
      screen: patch.screen,
      step: patch.step,
      payloadJson: patch.payloadJson ?? {},
      screenMessageId: patch.screenMessageId ?? undefined,
      weekAnchor: patch.weekAnchor ?? undefined,
      dayIso: patch.dayIso ?? undefined,
    },
  });
}

function toIsoFromWeekOffset(baseIso: string, offset: number, timezone: string): string {
  const baseUtc = zonedTimeToUtc(`${baseIso}T00:00:00`, timezone);
  return isoDayInTz(addDays(baseUtc, offset), timezone);
}

async function buildScreen(params: RenderParams): Promise<ScreenRenderResult> {
  const { prisma, chatId, screen } = params;
  const settings = await prisma.therapistSettings.findUnique({ where: { telegramChatId: chatId } });
  if (!settings) {
    throw new Error("Therapist settings not found for chat");
  }
  const timezone = safeTimezone(settings);

  if (screen === "home") {
    const todayIso = isoDayInTz(new Date(), timezone);
    const todayRange = rangeForIsoDay(todayIso, timezone);
    const todayCount = await prisma.appointment.count({
      where: {
        status: AppointmentStatus.planned,
        startAt: { gte: todayRange.from, lte: todayRange.to },
      },
    });
    const next = await prisma.appointment.findFirst({
      where: {
        status: AppointmentStatus.planned,
        startAt: { gte: new Date() },
      },
      include: { client: { select: { displayName: true } } },
      orderBy: { startAt: "asc" },
    });

    const nextLabel = next ? `${hhmm(next.startAt, timezone)} — ${shortClientName(next.client.displayName)}` : "—";
    return {
      screen: "home",
      step: "idle",
      text: [
        "🧠 Therapist Scheduler",
        `Сегодня: ${todayCount} записей • Следующая: ${nextLabel}`,
        "",
        "Пример: “Василиса завтра 10:00” или “слоты для Василисы на следующей неделе”",
      ].join("\n"),
      keyboard: [
        [
          { text: "🗓 Сегодня", callback_data: "scr:today" },
          { text: "📅 Неделя", callback_data: "scr:week" },
          { text: "👤 Клиенты", callback_data: "scr:clients" },
        ],
        [
          { text: "➕ Новая запись", callback_data: "scr:new" },
          { text: "⚙️ Настройки", callback_data: "scr:settings" },
          { text: "🔎 Поиск", callback_data: "cl:search" },
        ],
      ],
    };
  }

  if (screen === "today" || screen === "day") {
    const dayIso = screen === "day" ? (params.dayIso || isoDayInTz(new Date(), timezone)) : isoDayInTz(new Date(), timezone);
    const dayRange = rangeForIsoDay(dayIso, timezone);
    const appts = await prisma.appointment.findMany({
      where: { startAt: { gte: dayRange.from, lte: dayRange.to } },
      include: { client: { select: { displayName: true } } },
      orderBy: { startAt: "asc" },
      take: 20,
    });
    const title = screen === "today" ? `🗓 Сегодня, ${dayTitle(dayRange.from, timezone)} (${timezone})` : `🗓 ${dayTitle(dayRange.from, timezone)} (${timezone})`;
    const body = appts.length
      ? appts.map((a, idx) => `${idx + 1}) ${hhmm(a.startAt, timezone)}-${hhmm(a.endAt, timezone)} • ${shortClientName(a.client.displayName)} • ${statusBadge(a.status)}`).join("\n")
      : "Нет записей на сегодня.";

    const rowEntries = appts.slice(0, 3).map((a, idx) => ({ text: `${idx + 1}`, callback_data: `ap:open:${a.id}` }));
    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
      [
        { text: "➕ Новая запись", callback_data: "scr:new" },
        { text: "🔁 Обновить", callback_data: screen === "today" ? "scr:today" : `scr:day:${dayIso}` },
        { text: "🏠 Домой", callback_data: "scr:home" },
      ],
      [
        { text: "📅 Неделя", callback_data: "scr:week" },
        { text: "⚙️ Настройки", callback_data: "scr:settings" },
      ],
    ];
    if (rowEntries.length) keyboard.unshift(rowEntries);

    return {
      screen,
      step: "idle",
      text: [title, "", body, "", "Выберите запись для действий или добавьте новую."].join("\n"),
      keyboard,
      dayIso,
    };
  }

  if (screen === "week") {
    const stateWeekAnchor = params.weekAnchor ? new Date(params.weekAnchor) : new Date();
    const monday = subDays(stateWeekAnchor, (Number(formatInTimeZone(stateWeekAnchor, timezone, "i")) + 6) % 7);
    const mondayIso = isoDayInTz(monday, timezone);
    const weekDays = DAY_ORDER.map((dow, idx) => {
      const dayIso = toIsoFromWeekOffset(mondayIso, idx, timezone);
      return { dow, dayIso, date: zonedTimeToUtc(`${dayIso}T00:00:00`, timezone) };
    });

    const weekRange = {
      from: rangeForIsoDay(weekDays[0].dayIso, timezone).from,
      to: rangeForIsoDay(weekDays[6].dayIso, timezone).to,
    };

    const appts = await prisma.appointment.findMany({
      where: { startAt: { gte: weekRange.from, lte: weekRange.to } },
      select: { startAt: true },
    });

    const counters = new Map<string, number>();
    for (const item of appts) {
      const iso = isoDayInTz(item.startAt, timezone);
      counters.set(iso, (counters.get(iso) ?? 0) + 1);
    }

    const textLines = weekDays.map((d) => `${DAY_LABELS[d.dow]} ${formatInTimeZone(d.date, timezone, "dd")}: ${counters.get(d.dayIso) ?? 0}`);

    return {
      screen: "week",
      step: "idle",
      text: [`📅 Неделя ${dayTitle(weekRange.from, timezone)} – ${dayTitle(weekRange.to, timezone)} (${timezone})`, "", ...textLines].join("\n"),
      keyboard: [
        [
          { text: "◀️", callback_data: "scr:week:prev" },
          { text: "▶️", callback_data: "scr:week:next" },
          { text: "🏠", callback_data: "scr:home" },
        ],
        weekDays.slice(0, 3).map((d) => ({ text: DAY_LABELS[d.dow], callback_data: `scr:day:${d.dayIso}` })),
        weekDays.slice(3, 6).map((d) => ({ text: DAY_LABELS[d.dow], callback_data: `scr:day:${d.dayIso}` })),
        [{ text: DAY_LABELS[weekDays[6].dow], callback_data: `scr:day:${weekDays[6].dayIso}` }, { text: "🗓 Сегодня", callback_data: "scr:today" }],
      ],
      weekAnchor: monday,
    };
  }

  if (screen === "clients") {
    const payload = (params.payload ?? {}) as Record<string, unknown>;
    const page = parsePageNumber(typeof payload.page === "number" ? String(payload.page) : undefined, 1);
    const take = 10;
    const skip = (page - 1) * take;

    const [clients, total] = await Promise.all([
      prisma.client.findMany({ orderBy: { displayName: "asc" }, skip, take }),
      prisma.client.count(),
    ]);

    const lines = clients.length
      ? clients.map((c, idx) => `${skip + idx + 1}) ${c.displayName}`)
      : ["Клиенты не найдены."];

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
      ...clients.map((c) => [{ text: c.displayName, callback_data: `cl:open:${c.id}` }]),
      [
        ...(page > 1 ? [{ text: "◀️", callback_data: `cl:list:page:${page - 1}` }] : []),
        ...(skip + take < total ? [{ text: "▶️", callback_data: `cl:list:page:${page + 1}` }] : []),
        { text: "🔎 Поиск", callback_data: "cl:search" },
      ],
      [
        { text: "➕ Новый клиент", callback_data: "cl:new" },
        { text: "🏠 Домой", callback_data: "scr:home" },
      ],
    ];

    return {
      screen: "clients",
      step: "list",
      payload: { page },
      text: [`👤 Клиенты (стр. ${page})`, "", ...lines].join("\n"),
      keyboard,
    };
  }

  if (screen === "new") {
    const payload = (params.payload ?? {}) as NewWizardPayload;
    const step = payload.step ?? "client";

    if (step === "client") {
      const recent = await prisma.client.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
      return {
        screen: "new",
        step,
        payload: { ...payload, step },
        text: ["➕ Новая запись", "Шаг 1/3: Клиент", "Выберите клиента или используйте поиск."].join("\n"),
        keyboard: [
          ...recent.map((c) => [{ text: c.displayName, callback_data: `nw:client:pick:${c.id}` }]),
          [
            { text: "🔎 Поиск", callback_data: "nw:client:search" },
            { text: "➕ Новый клиент", callback_data: "cl:new" },
            { text: "🚪 Выход", callback_data: "nw:exit" },
          ],
        ],
      };
    }

    if (step === "day") {
      const dayButtons = [0, 1, 2, 3, 4, 5, 6].map((offset) => {
        const iso = isoDayInTz(addDays(new Date(), offset), timezone);
        return { text: dayTitle(zonedTimeToUtc(`${iso}T00:00:00`, timezone), timezone), callback_data: `nw:day:pick:${iso}` };
      });
      return {
        screen: "new",
        step,
        payload: { ...payload, step },
        text: ["➕ Новая запись", "Шаг 2/3: День", "Выберите день:"].join("\n"),
        keyboard: [
          [
            { text: "Сегодня", callback_data: "nw:day:today" },
            { text: "Завтра", callback_data: "nw:day:tomorrow" },
          ],
          dayButtons.slice(0, 3),
          dayButtons.slice(3, 6),
          [dayButtons[6]],
          [
            { text: "← Назад", callback_data: "scr:new" },
            { text: "🚪 Выход", callback_data: "nw:exit" },
          ],
        ],
      };
    }

    if (step === "time") {
      const slots = payload.slotOptions ?? [];
      const lines = slots.length
        ? slots.map((slot, idx) => `${idx + 1}) ${slot.label}`)
        : ["Нет доступных слотов. Выберите другой день."];
      return {
        screen: "new",
        step,
        payload: { ...payload, step },
        text: ["➕ Новая запись", "Шаг 3/3: Время", ...lines].join("\n"),
        keyboard: [
          ...slots.slice(0, 10).map((slot) => [{ text: slot.label, callback_data: `nw:time:pick:${slot.pendingId}` }]),
          [
            { text: "← Назад", callback_data: "nw:back:day" },
            { text: "🚪 Выход", callback_data: "nw:exit" },
          ],
        ],
      };
    }

    if (step === "confirm") {
      const selected = slotsFromPayload(payload).find((s) => s.pendingId === payload.selectedPendingId);
      return {
        screen: "new",
        step,
        payload: { ...payload, step },
        text: [
          "Подтвердите запись:",
          `${payload.clientName ?? "Клиент"}, ${selected?.label ?? "выбранный слот"}`,
        ].join("\n"),
        keyboard: [
          [
            { text: "✅ Создать", callback_data: `nw:save:${payload.selectedPendingId ?? ""}` },
            { text: "❌ Отмена", callback_data: "nw:exit" },
          ],
          [{ text: "🏠 Домой", callback_data: "scr:home" }],
        ],
      };
    }
  }

  if (screen === "settings") {
    const payload = (params.payload ?? {}) as Record<string, unknown>;
    const days = (payload.days as string[]) ?? settings.workDays;
    const start = typeof payload.start === "string" ? payload.start : settings.workStart;
    const end = typeof payload.end === "string" ? payload.end : settings.workEnd;
    const tz = typeof payload.timezone === "string" ? payload.timezone : timezone;

    return {
      screen: "settings",
      step: params.step ?? "menu",
      payload: { days, start, end, timezone: tz, awaitInput: payload.awaitInput },
      text: [
        "⚙️ Настройки",
        `Дни: ${days.join(", ")}`,
        `Время: ${start}-${end}`,
        `TZ: ${tz}`,
        `Сессия/буфер: ${settings.sessionMinutes}/${settings.bufferMinutes}`,
      ].join("\n"),
      keyboard: [
        [
          { text: "📆 Рабочие дни", callback_data: "st:days" },
          { text: "⏰ Рабочее время", callback_data: "st:time" },
          { text: "🌍 Таймзона", callback_data: "st:tz" },
        ],
        [
          { text: "✅ Сохранить", callback_data: "st:save" },
          { text: "🚪 Выход", callback_data: "st:exit" },
          { text: "🏠 Домой", callback_data: "scr:home" },
        ],
      ],
    };
  }

  if (screen === "appointment_card") {
    const appointmentId = String(params.payload?.appointmentId || "");
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { client: { select: { displayName: true } } },
    });
    if (!appointment) {
      return {
        screen: "today",
        step: "idle",
        text: "Запись не найдена.",
        keyboard: [[{ text: "🏠 Домой", callback_data: "scr:home" }]],
      };
    }

    const baseRow = [{ text: "← Назад", callback_data: "scr:today" }];
    const plannedRow = [
      { text: "✅ Done", callback_data: `ap:done:${appointment.id}` },
      { text: "❌ Cancel", callback_data: `ap:cancel:${appointment.id}` },
      { text: "↔ Перенести", callback_data: `ap:resched:${appointment.id}` },
    ];

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = appointment.status === AppointmentStatus.planned
      ? [plannedRow, [{ text: "📝 Заметка", callback_data: `ap:note:${appointment.id}` }, ...baseRow]]
      : [[{ text: "↔ Перенести", callback_data: `ap:resched:${appointment.id}` }, ...baseRow]];

    return {
      screen: "appointment_card",
      step: "idle",
      payload: { appointmentId: appointment.id },
      text: [
        "🧾 Запись",
        `Клиент: ${appointment.client.displayName}`,
        `Время: ${dayTitle(appointment.startAt, timezone)} • ${hhmm(appointment.startAt, timezone)}-${hhmm(appointment.endAt, timezone)} (${timezone})`,
        `Статус: ${appointment.status}`,
        `Тип: ${appointment.kind}`,
        `Заметка: ${appointment.notes || "—"}`,
      ].join("\n"),
      keyboard,
    };
  }

  return {
    screen: "home",
    step: "idle",
    text: "Раздел в разработке.",
    keyboard: [[{ text: "🏠 Домой", callback_data: "scr:home" }]],
  };
}

async function editOrSendScreen(params: RenderParams & { rendered: ScreenRenderResult }): Promise<void> {
  const { prisma, ctx, chatId, rendered, preferredMessageId } = params;
  const existing = await ensureState(prisma, chatId);
  const targetMessageId = preferredMessageId ?? existing.screenMessageId;

  const doSend = async () => {
    const sent = await ctx.telegram.sendMessage(chatId, rendered.text, {
      reply_markup: { inline_keyboard: rendered.keyboard },
    });
    await upsertState(prisma, chatId, {
      screen: rendered.screen,
      step: rendered.step,
      payloadJson: (rendered.payload ?? {}) as Prisma.InputJsonValue,
      screenMessageId: String(sent.message_id),
      weekAnchor: rendered.weekAnchor ?? null,
      dayIso: rendered.dayIso ?? null,
    });
  };

  if (!targetMessageId) {
    await doSend();
    return;
  }

  try {
    await ctx.telegram.editMessageText(chatId, Number(targetMessageId), undefined, rendered.text, {
      reply_markup: { inline_keyboard: rendered.keyboard },
    });
    await upsertState(prisma, chatId, {
      screen: rendered.screen,
      step: rendered.step,
      payloadJson: (rendered.payload ?? {}) as Prisma.InputJsonValue,
      screenMessageId: String(targetMessageId),
      weekAnchor: rendered.weekAnchor ?? null,
      dayIso: rendered.dayIso ?? null,
    });
  } catch {
    await doSend();
  }
}

export async function renderScreen(params: RenderParams): Promise<void> {
  const rendered = await buildScreen(params);
  await editOrSendScreen({ ...params, rendered });
}

export async function openHomeScreen(prisma: PrismaClient, ctx: Context, chatId: string): Promise<void> {
  await cleanupPending(prisma, chatId);
  await renderScreen({ prisma, ctx, chatId, screen: "home" });
}

export async function tryHandleNavigationText(prisma: PrismaClient, ctx: Context, chatId: string, text: string): Promise<boolean> {
  const normalized = text.trim().toLowerCase();
  if (["сегодня", "today"].includes(normalized)) {
    await renderScreen({ prisma, ctx, chatId, screen: "today" });
    return true;
  }
  if (["неделя", "week"].includes(normalized)) {
    await renderScreen({ prisma, ctx, chatId, screen: "week" });
    return true;
  }
  if (["клиенты", "clients"].includes(normalized)) {
    await renderScreen({ prisma, ctx, chatId, screen: "clients" });
    return true;
  }
  if (normalized === "настройки" || normalized === "/settings") {
    await renderScreen({ prisma, ctx, chatId, screen: "settings" });
    return true;
  }
  if (normalized === "новая запись") {
    await renderScreen({ prisma, ctx, chatId, screen: "new", payload: { step: "client" } });
    return true;
  }
  return false;
}

export async function handleWizardTextInput(prisma: PrismaClient, ctx: Context, chatId: string, text: string): Promise<boolean> {
  const state = await prisma.conversationState.findUnique({ where: { chatId } });
  if (!state) return false;

  const payload = ((state.payloadJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;

  if (state.screen === "clients") {
    if (payload.awaitInput === "client_new") {
      const name = text.trim();
      if (name.length < 2) {
        await ctx.reply("Введите имя клиента (минимум 2 символа).");
        return true;
      }
      const normalized = normalizeClientName(name);
      const created = await prisma.client.upsert({
        where: { normalizedName: normalized },
        update: { displayName: name },
        create: { displayName: name, normalizedName: normalized },
      });
      await ctx.reply(`Клиент сохранен: ${created.displayName}`);
      await renderScreen({ prisma, ctx, chatId, screen: "clients", payload: { page: 1 }, preferredMessageId: state.screenMessageId });
      return true;
    }

    if (payload.awaitInput === "client_search") {
      const query = text.trim();
      if (query.length < 2) {
        await ctx.reply("Введите минимум 2 символа для поиска.");
        return true;
      }
      const normalized = normalizeClientName(query);
      const clients = await prisma.client.findMany({
        where: {
          OR: [
            { displayName: { contains: query, mode: "insensitive" } },
            { normalizedName: { contains: normalized } },
          ],
        },
        orderBy: { displayName: "asc" },
        take: 8,
      });
      if (!clients.length) {
        await ctx.reply("Совпадений не найдено.");
        return true;
      }
      await ctx.reply("Результаты поиска:", {
        reply_markup: {
          inline_keyboard: [
            ...clients.map((c) => [{ text: c.displayName, callback_data: `cl:open:${c.id}` }]),
            [{ text: "🏠 Домой", callback_data: "scr:home" }],
          ],
        },
      });
      return true;
    }
  }

  if (state.screen === "new") {
    const wizard = payload as NewWizardPayload;
    const step = wizard.step ?? "client";

    if (step === "client") {
      const query = text.trim();
      if (query.length < 2) {
        await ctx.reply("Введите имя клиента (минимум 2 символа).");
        return true;
      }
      const normalized = normalizeClientName(query);
      const matches = await prisma.client.findMany({
        where: {
          OR: [
            { displayName: { contains: query, mode: "insensitive" } },
            { normalizedName: { contains: normalized } },
          ],
        },
        orderBy: { displayName: "asc" },
        take: 5,
      });

      if (matches.length === 1) {
        await renderScreen({
          prisma,
          ctx,
          chatId,
          screen: "new",
          payload: { step: "day", clientId: matches[0].id, clientName: matches[0].displayName },
          preferredMessageId: state.screenMessageId,
        });
        return true;
      }

      if (matches.length > 1) {
        await ctx.reply("Нашел несколько клиентов, выберите:", {
          reply_markup: {
            inline_keyboard: matches.map((c) => [{ text: c.displayName, callback_data: `nw:client:pick:${c.id}` }]),
          },
        });
        return true;
      }

      const created = await prisma.client.create({
        data: { displayName: query, normalizedName: normalized },
      });
      await renderScreen({
        prisma,
        ctx,
        chatId,
        screen: "new",
        payload: { step: "day", clientId: created.id, clientName: created.displayName },
        preferredMessageId: state.screenMessageId,
      });
      return true;
    }

    if (step === "day") {
      const settings = await getChatSettings(prisma, chatId);
      const timezone = settings ? safeTimezone(settings) : "Asia/Bangkok";
      const dayIso = normalizeDateInput(text, timezone);
      if (!dayIso) {
        await ctx.reply("Не понял дату. Используйте “сегодня”, “завтра”, YYYY-MM-DD или dd.mm.");
        return true;
      }
      const clientId = String(wizard.clientId || "");
      const built = await buildDaySlotOptions({ prisma, chatId, clientId, dayIso });
      if (!built) {
        await renderScreen({ prisma, ctx, chatId, screen: "new", payload: { step: "client" }, preferredMessageId: state.screenMessageId });
        return true;
      }
      await renderScreen({
        prisma,
        ctx,
        chatId,
        screen: "new",
        payload: {
          step: "time",
          clientId: built.clientId,
          clientName: built.clientName,
          dayIso,
          slotOptions: built.slotOptions,
        },
        preferredMessageId: state.screenMessageId,
      });
      return true;
    }
  }

  if (state.screen !== "settings") {
    return false;
  }

  if (payload.awaitInput === "time_start") {
    if (!isValidHHMM(text)) {
      await ctx.reply("Не понял время. Введите HH:MM, например 10:30.");
      return true;
    }
    const next = { ...payload, start: text, awaitInput: null };
    await renderScreen({ prisma, ctx, chatId, screen: "settings", payload: next, preferredMessageId: state.screenMessageId });
    return true;
  }
  if (payload.awaitInput === "time_end") {
    if (!isValidHHMM(text)) {
      await ctx.reply("Не понял время. Введите HH:MM, например 10:30.");
      return true;
    }
    const start = String(payload.start || "10:00");
    if (!ensureHoursOrder(start, text)) {
      await ctx.reply("Конец дня должен быть минимум на 1 час позже начала.");
      return true;
    }
    const next = { ...payload, end: text, awaitInput: null };
    await renderScreen({ prisma, ctx, chatId, screen: "settings", payload: next, preferredMessageId: state.screenMessageId });
    return true;
  }
  if (payload.awaitInput === "day_pick") {
    const settings = await prisma.therapistSettings.findUnique({ where: { telegramChatId: chatId } });
    const tz = settings ? safeTimezone(settings) : "Asia/Bangkok";
    const iso = normalizeDateInput(text, tz);
    if (!iso) {
      await ctx.reply("Не понял дату. Используйте “сегодня”, “завтра”, YYYY-MM-DD или dd.mm.");
      return true;
    }
    await renderScreen({ prisma, ctx, chatId, screen: "day", dayIso: iso, preferredMessageId: state.screenMessageId });
    return true;
  }

  return false;
}

export async function handleUiCallback(prisma: PrismaClient, ctx: Context, chatId: string, data: string): Promise<boolean> {
  await cleanupPending(prisma, chatId);
  const state = await ensureState(prisma, chatId);
  const preferredMessageId = state.screenMessageId;

  if (data === "scr:home") {
    await renderScreen({ prisma, ctx, chatId, screen: "home", preferredMessageId });
    return true;
  }
  if (data === "scr:today") {
    await renderScreen({ prisma, ctx, chatId, screen: "today", preferredMessageId });
    return true;
  }
  if (data === "scr:week") {
    await renderScreen({ prisma, ctx, chatId, screen: "week", preferredMessageId });
    return true;
  }
  if (data === "scr:week:prev" || data === "scr:week:next") {
    const anchor = state.weekAnchor ?? new Date();
    const next = data.endsWith(":prev") ? subDays(anchor, 7) : addDays(anchor, 7);
    await renderScreen({ prisma, ctx, chatId, screen: "week", weekAnchor: next, preferredMessageId });
    return true;
  }
  if (data.startsWith("scr:day:")) {
    const iso = data.slice("scr:day:".length);
    await renderScreen({ prisma, ctx, chatId, screen: "day", dayIso: iso, preferredMessageId });
    return true;
  }
  if (data === "scr:settings") {
    await renderScreen({ prisma, ctx, chatId, screen: "settings", preferredMessageId });
    return true;
  }
  if (data === "scr:clients") {
    await renderScreen({ prisma, ctx, chatId, screen: "clients", payload: { page: 1 }, preferredMessageId });
    return true;
  }
  if (data.startsWith("cl:list:page:")) {
    const page = parsePageNumber(data.slice("cl:list:page:".length), 1);
    await renderScreen({ prisma, ctx, chatId, screen: "clients", payload: { page }, preferredMessageId });
    return true;
  }
  if (data.startsWith("cl:open:")) {
    const clientId = data.slice("cl:open:".length);
    await renderScreen({ prisma, ctx, chatId, screen: "new", payload: { step: "day", clientId }, preferredMessageId });
    return true;
  }
  if (data === "cl:search" || data === "nw:client:search" || data === "cl:new") {
    if (data === "cl:new") {
      await upsertState(prisma, chatId, {
        screen: "clients",
        step: "new_client",
        payloadJson: { awaitInput: "client_new" } as Prisma.InputJsonValue,
        screenMessageId: preferredMessageId,
      });
      await ctx.reply("Введите имя нового клиента.");
      return true;
    }

    if (data === "nw:client:search") {
      const currentPayload = ((state.payloadJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
      await upsertState(prisma, chatId, {
        screen: "new",
        step: "client",
        payloadJson: { ...currentPayload, step: "client", awaitInput: "new_client_search" } as Prisma.InputJsonValue,
        screenMessageId: preferredMessageId,
      });
      await ctx.reply("Введите имя клиента для поиска или создания.");
      return true;
    }

    await upsertState(prisma, chatId, {
      screen: "clients",
      step: "search",
      payloadJson: { awaitInput: "client_search" } as Prisma.InputJsonValue,
      screenMessageId: preferredMessageId,
    });
    await ctx.reply("Введите имя клиента для поиска.");
    await renderScreen({ prisma, ctx, chatId, screen: "clients", payload: { page: 1 }, preferredMessageId });
    return true;
  }

  if (data === "scr:new") {
    await renderScreen({ prisma, ctx, chatId, screen: "new", payload: { step: "client" }, preferredMessageId });
    return true;
  }
  if (data.startsWith("nw:client:pick:")) {
    const clientId = data.slice("nw:client:pick:".length);
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      await ctx.reply("Клиент не найден. Выберите другого.");
      return true;
    }
    await renderScreen({
      prisma,
      ctx,
      chatId,
      screen: "new",
      payload: { step: "day", clientId: client.id, clientName: client.displayName },
      preferredMessageId,
    });
    return true;
  }

  if (data === "nw:day:today" || data === "nw:day:tomorrow" || data.startsWith("nw:day:pick:")) {
    const statePayload = ((state.payloadJson as Record<string, unknown> | null) ?? {}) as NewWizardPayload;
    const settings = await getChatSettings(prisma, chatId);
    if (!settings) return true;
    const timezone = safeTimezone(settings);
    const dayIso = data === "nw:day:today"
      ? isoDayInTz(new Date(), timezone)
      : data === "nw:day:tomorrow"
      ? isoDayInTz(addDays(new Date(), 1), timezone)
      : data.slice("nw:day:pick:".length);

    const clientId = String(statePayload.clientId || "");
    const built = await buildDaySlotOptions({ prisma, chatId, clientId, dayIso });
    if (!built) {
      await renderScreen({ prisma, ctx, chatId, screen: "new", payload: { step: "client" }, preferredMessageId });
      return true;
    }

    await renderScreen({
      prisma,
      ctx,
      chatId,
      screen: "new",
      payload: {
        step: "time",
        clientId: built.clientId,
        clientName: built.clientName,
        dayIso,
        slotOptions: built.slotOptions,
      },
      preferredMessageId,
    });
    return true;
  }

  if (data.startsWith("nw:time:pick:")) {
    const pendingId = data.slice("nw:time:pick:".length);
    const statePayload = ((state.payloadJson as Record<string, unknown> | null) ?? {}) as NewWizardPayload;
    await renderScreen({
      prisma,
      ctx,
      chatId,
      screen: "new",
      payload: {
        ...statePayload,
        step: "confirm",
        selectedPendingId: pendingId,
      },
      preferredMessageId,
    });
    return true;
  }

  if (data.startsWith("nw:save:")) {
    const pendingId = data.slice("nw:save:".length);
    const pending = await prisma.pendingAction.findUnique({ where: { id: pendingId } });
    if (!pending || pending.chatId !== chatId || pending.type !== PendingActionType.pick_slot || pending.expiresAt < new Date()) {
      await ctx.reply("Слот устарел. Выберите заново.");
      await renderScreen({ prisma, ctx, chatId, screen: "new", payload: { step: "client" }, preferredMessageId });
      return true;
    }
    const payload = pending.payloadJson as Record<string, unknown>;
    const clientId = String(payload.clientId || "");
    const startAtIso = String(payload.startAtIso || "");
    const endAtIso = String(payload.endAtIso || "");
    if (!clientId || !startAtIso || !endAtIso) {
      await ctx.reply("Не удалось создать запись из выбранного слота.");
      return true;
    }
    const created = await prisma.appointment.create({
      data: {
        clientId,
        startAt: new Date(startAtIso),
        endAt: new Date(endAtIso),
        status: AppointmentStatus.planned,
      },
      include: { client: { select: { displayName: true } } },
    });
    await prisma.pendingAction.delete({ where: { id: pending.id } });
    const settings = await getChatSettings(prisma, chatId);
    const timezone = settings ? safeTimezone(settings) : "Asia/Bangkok";
    await ctx.reply(
      [
        "Ок, записал:",
        `${created.client.displayName}`,
        `${dayTitle(created.startAt, timezone)} • ${hhmm(created.startAt, timezone)}-${hhmm(created.endAt, timezone)}`,
      ].join("\n")
    );
    await renderScreen({
      prisma,
      ctx,
      chatId,
      screen: "appointment_card",
      payload: { appointmentId: created.id },
      preferredMessageId,
    });
    return true;
  }

  if (data === "nw:back:day") {
    const statePayload = ((state.payloadJson as Record<string, unknown> | null) ?? {}) as NewWizardPayload;
    await renderScreen({ prisma, ctx, chatId, screen: "new", payload: { ...statePayload, step: "day" }, preferredMessageId });
    return true;
  }

  if (data === "nw:exit") {
    await renderScreen({ prisma, ctx, chatId, screen: "home", preferredMessageId });
    return true;
  }

  if (data.startsWith("ap:open:")) {
    await renderScreen({ prisma, ctx, chatId, screen: "appointment_card", payload: { appointmentId: data.slice("ap:open:".length) }, preferredMessageId });
    return true;
  }

  if (data.startsWith("ap:done:")) {
    const id = data.slice("ap:done:".length);
    await prisma.appointment.update({ where: { id }, data: { status: AppointmentStatus.done } });
    await renderScreen({ prisma, ctx, chatId, screen: "appointment_card", payload: { appointmentId: id }, preferredMessageId });
    return true;
  }

  if (data.startsWith("ap:cancel:")) {
    const id = data.slice("ap:cancel:".length);
    const pending = await prisma.pendingAction.create({
      data: {
        chatId,
        type: PendingActionType.confirm_cancel,
        payloadJson: { appointmentId: id },
        expiresAt: addDays(new Date(), 1),
      },
    });
    await ctx.reply("Подтвердите действие:\nОтмена записи", {
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Подтвердить", callback_data: `p:confirm:${pending.id}` },
          { text: "❌ Отмена", callback_data: `p:cancel:${pending.id}` },
        ]],
      },
    });
    return true;
  }

  if (data === "st:days") {
    const settings = await prisma.therapistSettings.findUnique({ where: { telegramChatId: chatId } });
    const payload = ((state.payloadJson as Record<string, unknown> | null) ?? {
      days: settings?.workDays ?? ["mon", "tue", "wed", "thu", "fri"],
      start: settings?.workStart ?? "10:00",
      end: settings?.workEnd ?? "18:00",
      timezone: settings?.timezone ?? "Asia/Bangkok",
    }) as Record<string, unknown>;
    const days = (payload.days as string[]) ?? [];
    await renderScreen({
      prisma,
      ctx,
      chatId,
      screen: "settings",
      step: "days",
      payload,
      preferredMessageId,
    });
    await ctx.reply(`📆 Рабочие дни\nТекущие: ${days.join(", ")}\nВыберите дни:`, {
      reply_markup: {
        inline_keyboard: [
          DAY_ORDER.slice(0, 4).map((d) => ({ text: `${days.includes(d) ? "✅ " : ""}${DAY_LABELS[d]}`, callback_data: `st:days:toggle:${d}` })),
          DAY_ORDER.slice(4).map((d) => ({ text: `${days.includes(d) ? "✅ " : ""}${DAY_LABELS[d]}`, callback_data: `st:days:toggle:${d}` })),
          [{ text: "Готово", callback_data: "st:days:done" }, { text: "❌ Отмена", callback_data: "st:exit" }],
        ],
      },
    });
    return true;
  }

  if (data.startsWith("st:days:toggle:")) {
    const day = data.slice("st:days:toggle:".length);
    const payload = ((state.payloadJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const days = new Set<string>((payload.days as string[]) ?? []);
    if (days.has(day)) {
      days.delete(day);
    } else {
      days.add(day);
    }
    await upsertState(prisma, chatId, {
      screen: "settings",
      step: "days",
      payloadJson: { ...payload, days: DAY_ORDER.filter((d) => days.has(d)) },
      screenMessageId: preferredMessageId,
    });
    await renderScreen({ prisma, ctx, chatId, screen: "settings", step: "days", payload: { ...payload, days: DAY_ORDER.filter((d) => days.has(d)) }, preferredMessageId });
    return true;
  }

  if (data === "st:days:done") {
    await renderScreen({ prisma, ctx, chatId, screen: "settings", preferredMessageId });
    return true;
  }

  if (data === "st:time") {
    await ctx.reply("⏰ Начало рабочего дня\nВыберите или введите HH:MM", {
      reply_markup: {
        inline_keyboard: [
          TIME_START_OPTIONS.map((value) => ({ text: value, callback_data: `st:time:start:set:${value.replace(":", "-")}` })),
          [{ text: "✏️ Ввести вручную", callback_data: "st:time:start:manual" }],
          [{ text: "← Назад", callback_data: "scr:settings" }],
        ],
      },
    });
    return true;
  }

  if (data.startsWith("st:time:start:set:")) {
    const value = data.slice("st:time:start:set:".length).replace("-", ":");
    if (!isValidHHMM(value)) return true;
    const payload = ((state.payloadJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    await upsertState(prisma, chatId, {
      screen: "settings",
      step: "menu",
      payloadJson: { ...payload, start: value, awaitInput: null },
      screenMessageId: preferredMessageId,
    });
    await ctx.reply("⏰ Конец рабочего дня", {
      reply_markup: {
        inline_keyboard: [
          TIME_END_OPTIONS.map((v) => ({ text: v, callback_data: `st:time:end:set:${v.replace(":", "-")}` })),
          [{ text: "✏️ Ввести вручную", callback_data: "st:time:end:manual" }],
          [{ text: "← Назад", callback_data: "scr:settings" }],
        ],
      },
    });
    return true;
  }

  if (data.startsWith("st:time:end:set:")) {
    const value = data.slice("st:time:end:set:".length).replace("-", ":");
    if (!isValidHHMM(value)) return true;
    const payload = ((state.payloadJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const start = String(payload.start || "10:00");
    if (!ensureHoursOrder(start, value)) {
      await ctx.reply("Конец дня должен быть минимум на 1 час позже начала.");
      return true;
    }
    await renderScreen({ prisma, ctx, chatId, screen: "settings", payload: { ...payload, end: value, awaitInput: null }, preferredMessageId });
    return true;
  }

  if (data === "st:time:start:manual") {
    const payload = ((state.payloadJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    await upsertState(prisma, chatId, {
      screen: "settings",
      step: "manual",
      payloadJson: { ...payload, awaitInput: "time_start" },
      screenMessageId: preferredMessageId,
    });
    await ctx.reply("Введите HH:MM, например 10:30.");
    return true;
  }

  if (data === "st:time:end:manual") {
    const payload = ((state.payloadJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    await upsertState(prisma, chatId, {
      screen: "settings",
      step: "manual",
      payloadJson: { ...payload, awaitInput: "time_end" },
      screenMessageId: preferredMessageId,
    });
    await ctx.reply("Введите HH:MM, например 18:30.");
    return true;
  }

  if (data === "st:tz") {
    await ctx.reply("🌍 Таймзона", {
      reply_markup: {
        inline_keyboard: [
          ...TZ_OPTIONS.map((tz) => [{ text: tz, callback_data: `st:tz:set:${tz.replace("/", "_")}` }]),
          [{ text: "← Назад", callback_data: "scr:settings" }],
        ],
      },
    });
    return true;
  }

  if (data.startsWith("st:tz:set:")) {
    const timezone = data.slice("st:tz:set:".length).replace("_", "/");
    const payload = ((state.payloadJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    await renderScreen({ prisma, ctx, chatId, screen: "settings", payload: { ...payload, timezone }, preferredMessageId });
    return true;
  }

  if (data === "st:save") {
    const payload = ((state.payloadJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const pending = await prisma.pendingAction.create({
      data: {
        chatId,
        type: PendingActionType.confirm_settings_save,
        payloadJson: payload as Prisma.InputJsonValue,
        expiresAt: addDays(new Date(), 1),
      },
    });
    await ctx.reply("Подтвердите действие:\nСохранить настройки расписания", {
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Подтвердить", callback_data: `p:confirm:${pending.id}` },
          { text: "❌ Отмена", callback_data: `p:cancel:${pending.id}` },
        ]],
      },
    });
    return true;
  }

  if (data === "st:exit") {
    await renderScreen({ prisma, ctx, chatId, screen: "home", preferredMessageId });
    return true;
  }

  if (data.startsWith("p:confirm:") || data.startsWith("p:cancel:")) {
    const isConfirm = data.startsWith("p:confirm:");
    const pendingId = data.split(":")[2];
    const pending = await prisma.pendingAction.findUnique({ where: { id: pendingId } });
    if (!pending || pending.chatId !== chatId || pending.expiresAt < new Date()) {
      await ctx.reply("Сессия выбора устарела, начните заново.");
      await renderScreen({ prisma, ctx, chatId, screen: "home", preferredMessageId });
      return true;
    }

    if (!isConfirm) {
      await prisma.pendingAction.delete({ where: { id: pending.id } });
      await renderScreen({ prisma, ctx, chatId, screen: "home", preferredMessageId });
      return true;
    }

    if (pending.type === PendingActionType.confirm_cancel) {
      const payload = pending.payloadJson as Record<string, unknown>;
      const appointmentId = String(payload.appointmentId || "");
      if (appointmentId) {
        await prisma.appointment.update({ where: { id: appointmentId }, data: { status: AppointmentStatus.canceled } });
        await prisma.pendingAction.delete({ where: { id: pending.id } });
        await renderScreen({ prisma, ctx, chatId, screen: "appointment_card", payload: { appointmentId }, preferredMessageId });
        return true;
      }
    }

    if (pending.type === PendingActionType.confirm_settings_save) {
      const payload = pending.payloadJson as Record<string, unknown>;
      const current = await prisma.therapistSettings.findUnique({ where: { telegramChatId: chatId } });
      if (current) {
        const days = Array.isArray(payload.days) ? (payload.days as string[]) : current.workDays;
        const start = typeof payload.start === "string" ? payload.start : current.workStart;
        const end = typeof payload.end === "string" ? payload.end : current.workEnd;
        const timezone = typeof payload.timezone === "string" ? payload.timezone : current.timezone;
        if (ensureHoursOrder(start, end)) {
          await prisma.therapistSettings.update({
            where: { telegramChatId: chatId },
            data: { workDays: days.length ? days : current.workDays, workStart: start, workEnd: end, timezone },
          });
        }
      }
      await prisma.pendingAction.delete({ where: { id: pending.id } });
      await renderScreen({ prisma, ctx, chatId, screen: "settings", preferredMessageId });
      return true;
    }

    await prisma.pendingAction.delete({ where: { id: pending.id } });
    await renderScreen({ prisma, ctx, chatId, screen: "home", preferredMessageId });
    return true;
  }

  return false;
}
