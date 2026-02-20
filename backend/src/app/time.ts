import { addDays } from "date-fns";
import { formatInTimeZone, utcToZonedTime, zonedTimeToUtc } from "date-fns-tz";
import { APP_TIMEZONE } from "./config";

const WEEKDAY_MAP: Record<string, number> = {
  воскресенье: 0,
  понедельник: 1,
  вторник: 2,
  среда: 3,
  четверг: 4,
  пятница: 5,
  суббота: 6,
};

export function toUtcFromMsk(dateTimeLocal: string): Date {
  return zonedTimeToUtc(dateTimeLocal, APP_TIMEZONE);
}

export function nowInMsk(): Date {
  return utcToZonedTime(new Date(), APP_TIMEZONE);
}

export function mskDayKey(date: Date): string {
  return formatInTimeZone(date, APP_TIMEZONE, "yyyy-MM-dd");
}

export function formatMskDateTime(date: Date): string {
  return formatInTimeZone(date, APP_TIMEZONE, "dd.MM HH:mm");
}

export function formatMskTime(date: Date): string {
  return formatInTimeZone(date, APP_TIMEZONE, "HH:mm");
}

export function todayRangeUtc(): { from: Date; to: Date } {
  const day = mskDayKey(new Date());
  return {
    from: toUtcFromMsk(`${day}T00:00:00`),
    to: toUtcFromMsk(`${day}T23:59:59`),
  };
}

export function rangeUtcForDayKey(dayKey: string): { from: Date; to: Date } {
  return {
    from: toUtcFromMsk(`${dayKey}T00:00:00`),
    to: toUtcFromMsk(`${dayKey}T23:59:59`),
  };
}

export function parseDueDateMsk(text: string): Date | null {
  const input = text.toLowerCase();
  const time = input.match(/(\d{1,2}):(\d{2})/);
  if (!time) return null;
  const hh = time[1].padStart(2, "0");
  const mm = time[2];
  const now = new Date();

  if (/(^|\s)сегодня(\s|$)/.test(input)) {
    const day = mskDayKey(now);
    return toUtcFromMsk(`${day}T${hh}:${mm}:00`);
  }
  if (/(^|\s)завтра(\s|$)/.test(input)) {
    const day = mskDayKey(addDays(now, 1));
    return toUtcFromMsk(`${day}T${hh}:${mm}:00`);
  }

  const dmY = input.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dmY) {
    const d = dmY[1].padStart(2, "0");
    const m = dmY[2].padStart(2, "0");
    return toUtcFromMsk(`${dmY[3]}-${m}-${d}T${hh}:${mm}:00`);
  }

  const dm = input.match(/(\d{1,2})\.(\d{1,2})/);
  if (dm) {
    const year = formatInTimeZone(now, APP_TIMEZONE, "yyyy");
    const d = dm[1].padStart(2, "0");
    const m = dm[2].padStart(2, "0");
    return toUtcFromMsk(`${year}-${m}-${d}T${hh}:${mm}:00`);
  }

  for (const [weekdayRu, weekdayIndex] of Object.entries(WEEKDAY_MAP)) {
    if (input.includes(weekdayRu)) {
      const base = nowInMsk();
      const current = base.getDay();
      let delta = weekdayIndex - current;
      if (delta <= 0) delta += 7;
      const targetDay = mskDayKey(addDays(base, delta));
      return toUtcFromMsk(`${targetDay}T${hh}:${mm}:00`);
    }
  }

  return null;
}
