const MOSCOW_OFFSET_HOURS = 3;

interface ParseOk {
  ok: true;
  value: {
    text: string;
    remindAt: Date;
    remindDateLabel: string;
    remindTimeLabel: string;
  };
}

interface ParseFail {
  ok: false;
  reason: "missing_date" | "invalid_time" | "empty_text" | "time_in_past" | "invalid_format";
}

export type ParseReminderResult = ParseOk | ParseFail;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getMoscowNowParts(nowUtc: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(nowUtc);
  const get = (type: string): number => {
    const value = parts.find((item) => item.type === type)?.value;
    return Number(value || "0");
  };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function toUtcFromMoscowDateTime(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - MOSCOW_OFFSET_HOURS, minute, 0, 0));
}

function addDaysMoscow(year: number, month: number, day: number, daysToAdd: number): { year: number; month: number; day: number } {
  const baseUtc = toUtcFromMoscowDateTime(year, month, day, 12, 0);
  baseUtc.setUTCDate(baseUtc.getUTCDate() + daysToAdd);
  const moscow = new Date(baseUtc.getTime() + MOSCOW_OFFSET_HOURS * 60 * 60 * 1000);
  return {
    year: moscow.getUTCFullYear(),
    month: moscow.getUTCMonth() + 1,
    day: moscow.getUTCDate(),
  };
}

function normalizeInput(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function stripCommandPrefix(value: string): string {
  return value.replace(/^напомни\s+/i, "").trim();
}

function cleanTaskText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseTime(hourRaw: string, minuteRaw: string): { hour: number; minute: number } | null {
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

function defaultTodayTime(nowUtc: Date): { hour: number; minute: number } {
  const nowMsk = new Date(nowUtc.getTime() + MOSCOW_OFFSET_HOURS * 60 * 60 * 1000);
  const hour = nowMsk.getUTCHours();
  if (hour < 10) {
    return { hour: 10, minute: 0 };
  }

  const nextHour = hour + 1;
  if (nextHour > 23) {
    return { hour: 23, minute: 59 };
  }
  return { hour: nextHour, minute: 10 };
}

export function parseReminderCommand(input: string, nowUtc = new Date()): ParseReminderResult {
  const normalized = normalizeInput(input);
  const withoutPrefix = stripCommandPrefix(normalized);

  const tomorrowWithTime = withoutPrefix.match(/^завтра\s+в\s+(\d{1,2}):(\d{2})\s+(.+)$/i);
  const todayWithTime = withoutPrefix.match(/^сегодня\s+в\s+(\d{1,2}):(\d{2})\s+(.+)$/i);
  const tomorrowDefault = withoutPrefix.match(/^завтра\s+(.+)$/i);
  const todayDefault = withoutPrefix.match(/^сегодня\s+(.+)$/i);

  const moscowNow = getMoscowNowParts(nowUtc);
  let year = moscowNow.year;
  let month = moscowNow.month;
  let day = moscowNow.day;
  let hour = -1;
  let minute = -1;
  let text = "";

  if (tomorrowWithTime) {
    const time = parseTime(tomorrowWithTime[1], tomorrowWithTime[2]);
    if (!time) {
      return { ok: false, reason: "invalid_time" };
    }
    ({ year, month, day } = addDaysMoscow(moscowNow.year, moscowNow.month, moscowNow.day, 1));
    hour = time.hour;
    minute = time.minute;
    text = cleanTaskText(tomorrowWithTime[3]);
  } else if (todayWithTime) {
    const time = parseTime(todayWithTime[1], todayWithTime[2]);
    if (!time) {
      return { ok: false, reason: "invalid_time" };
    }
    hour = time.hour;
    minute = time.minute;
    text = cleanTaskText(todayWithTime[3]);
  } else if (tomorrowDefault) {
    ({ year, month, day } = addDaysMoscow(moscowNow.year, moscowNow.month, moscowNow.day, 1));
    hour = 10;
    minute = 0;
    text = cleanTaskText(tomorrowDefault[1]);
  } else if (todayDefault) {
    const todayTime = defaultTodayTime(nowUtc);
    hour = todayTime.hour;
    minute = todayTime.minute;
    text = cleanTaskText(todayDefault[1]);
  } else if (/\b(сегодня|завтра)\b/i.test(withoutPrefix)) {
    return { ok: false, reason: "invalid_format" };
  } else {
    return { ok: false, reason: "missing_date" };
  }

  if (hour < 0 || minute < 0) {
    return { ok: false, reason: "invalid_format" };
  }

  if (!text) {
    return { ok: false, reason: "empty_text" };
  }

  const remindAt = toUtcFromMoscowDateTime(year, month, day, hour, minute);
  if (remindAt.getTime() <= nowUtc.getTime()) {
    return { ok: false, reason: "time_in_past" };
  }

  const remindDateLabel = `${pad2(day)}.${pad2(month)}`;
  const remindTimeLabel = `${pad2(hour)}:${pad2(minute)}`;

  return {
    ok: true,
    value: {
      text,
      remindAt,
      remindDateLabel,
      remindTimeLabel,
    },
  };
}
