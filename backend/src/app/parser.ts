import { parseDueDateMsk } from "./time";

export interface ParsedTaskSpec {
  text: string;
  important: boolean;
  dueAt: Date | null;
  remindEveryMinutes: number | null;
  askReminderClarification: boolean;
}

function parseFrequencyMinutes(text: string): number | null {
  const m = text.toLowerCase().match(/каждые\s+(\d+)\s*(минут|минута|минуты|час|часа|часов|дня|дней)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit.startsWith("мин")) return n;
  if (unit.startsWith("час")) return n * 60;
  return n * 24 * 60;
}

export function parseTaskSpec(input: string): ParsedTaskSpec {
  const source = input.trim();
  const important = /^\s*!/.test(source) || /(важно|срочно)/i.test(source);
  const dueAt = parseDueDateMsk(source);
  const remindEveryMinutes = parseFrequencyMinutes(source);
  const asksReminders = /напоминай|напоминани/i.test(source);

  let text = source
    .replace(/каждые\s+\d+\s*(минут|минута|минуты|час|часа|часов|дня|дней)/gi, "")
    .replace(/\b(сегодня|завтра)\b\s*\d{1,2}:\d{2}/gi, "")
    .replace(/\d{1,2}\.\d{1,2}(\.\d{4})?\s*\d{1,2}:\d{2}/g, "")
    .replace(/в\s+(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)\s*\d{1,2}:\d{2}/gi, "")
    .replace(/^[!\s]+/, "")
    .replace(/[\s,]+$/g, "")
    .trim();

  if (!text) text = source;

  return {
    text,
    important,
    dueAt,
    remindEveryMinutes,
    askReminderClarification: asksReminders && !dueAt,
  };
}
