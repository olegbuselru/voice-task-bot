import { addDays, addMinutes, isBefore } from "date-fns";
import { formatInTimeZone, utcToZonedTime, zonedTimeToUtc } from "date-fns-tz";

export interface WorkingSettings {
  timezone: string;
  workDays: string[];
  workStart: string;
  workEnd: string;
  sessionMinutes: number;
  bufferMinutes: number;
}

export interface BusyAppointment {
  startAt: Date;
  endAt: Date;
}

export interface AvailabilitySlot {
  startAt: Date;
  endAt: Date;
}

interface Interval {
  start: Date;
  end: Date;
}

const DOW_MAP = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function parseTimeToMinutes(hhmm: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return fallback;
  }
  return h * 60 + min;
}

function dateKeyInZone(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

function buildWorkWindow(date: Date, settings: WorkingSettings): Interval | null {
  const dayKey = DOW_MAP[utcToZonedTime(date, settings.timezone).getDay()];
  if (!settings.workDays.includes(dayKey)) {
    return null;
  }

  const startMins = parseTimeToMinutes(settings.workStart, 10 * 60);
  const endMins = parseTimeToMinutes(settings.workEnd, 18 * 60);
  if (endMins <= startMins) {
    return null;
  }

  const key = dateKeyInZone(date, settings.timezone);
  const startH = String(Math.floor(startMins / 60)).padStart(2, "0");
  const startM = String(startMins % 60).padStart(2, "0");
  const endH = String(Math.floor(endMins / 60)).padStart(2, "0");
  const endM = String(endMins % 60).padStart(2, "0");

  return {
    start: zonedTimeToUtc(`${key}T${startH}:${startM}:00`, settings.timezone),
    end: zonedTimeToUtc(`${key}T${endH}:${endM}:00`, settings.timezone),
  };
}

function subtractInterval(source: Interval, busy: Interval): Interval[] {
  if (!isBefore(source.start, source.end)) return [];
  if (!isBefore(busy.start, busy.end)) return [source];

  const overlaps = isBefore(busy.start, source.end) && isBefore(source.start, busy.end);
  if (!overlaps) return [source];

  const out: Interval[] = [];
  if (isBefore(source.start, busy.start)) {
    out.push({ start: source.start, end: busy.start });
  }
  if (isBefore(busy.end, source.end)) {
    out.push({ start: busy.end, end: source.end });
  }
  return out.filter((i) => isBefore(i.start, i.end));
}

export function computeAvailabilitySlots(params: {
  from: Date;
  to: Date;
  settings: WorkingSettings;
  appointments: BusyAppointment[];
  limit: number;
}): AvailabilitySlot[] {
  const { from, to, settings, appointments } = params;
  const max = Math.max(1, Math.min(20, params.limit || 8));
  const stepMinutes = 10;
  const sessionMinutes = settings.sessionMinutes > 0 ? settings.sessionMinutes : 50;
  const bufferMinutes = settings.bufferMinutes >= 0 ? settings.bufferMinutes : 10;

  const busy = appointments
    .map((a) => ({
      start: addMinutes(a.startAt, -bufferMinutes),
      end: addMinutes(a.endAt, bufferMinutes),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const slots: AvailabilitySlot[] = [];
  let cursor = utcToZonedTime(from, settings.timezone);

  while (slots.length < max) {
    const cursorUtc = zonedTimeToUtc(
      `${formatInTimeZone(cursor, settings.timezone, "yyyy-MM-dd")}T00:00:00`,
      settings.timezone
    );
    if (!isBefore(cursorUtc, addDays(to, 1))) {
      break;
    }

    const window = buildWorkWindow(cursorUtc, settings);
    if (window) {
      let freeIntervals: Interval[] = [window];
      for (const b of busy) {
        freeIntervals = freeIntervals.flatMap((f) => subtractInterval(f, b));
        if (!freeIntervals.length) break;
      }

      for (const interval of freeIntervals) {
        let start = new Date(interval.start);
        while (addMinutes(start, sessionMinutes).getTime() <= interval.end.getTime()) {
          const end = addMinutes(start, sessionMinutes);
          if (start.getTime() >= from.getTime() && end.getTime() <= to.getTime()) {
            slots.push({ startAt: new Date(start), endAt: end });
            if (slots.length >= max) return slots;
          }
          start = addMinutes(start, stepMinutes);
        }
      }
    }

    cursor = addDays(cursor, 1);
  }

  return slots;
}
