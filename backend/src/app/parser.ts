import { parseDueDateMsk } from "./time";

export type ParsedTaskCategory = "none" | "work" | "personal";

export interface ParsedTaskSpec {
  text: string;
  important: boolean;
  category: ParsedTaskCategory;
  dueAt: Date | null;
  remindEveryMinutes: number | null;
  askReminderClarification: boolean;
}

function parseCategory(text: string): ParsedTaskCategory {
  const source = text.toLowerCase();
  const personalIdx = source.search(/(^|\s)личное(\s|$)/);
  const workIdx = source.search(/(^|\s)рабочее(\s|$)/);

  if (personalIdx === -1 && workIdx === -1) return "none";
  if (personalIdx === -1) return "work";
  if (workIdx === -1) return "personal";
  return personalIdx <= workIdx ? "personal" : "work";
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
  const category = parseCategory(source);
  const dueAt = parseDueDateMsk(source);
  const remindEveryMinutes = parseFrequencyMinutes(source);
  const asksReminders = /напоминай|напоминани/i.test(source);

  let text = source
    .replace(/каждые\s+\d+\s*(минут|минута|минуты|час|часа|часов|дня|дней)/gi, "")
    .replace(/\b(сегодня|завтра)\b\s*\d{1,2}:\d{2}/gi, "")
    .replace(/\d{1,2}\.\d{1,2}(\.\d{4})?\s*\d{1,2}:\d{2}/g, "")
    .replace(/в\s+(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)\s*\d{1,2}:\d{2}/gi, "")
    .replace(/(^|\s)(личное|рабочее)(\s|$)/gi, " ")
    .replace(/^[!\s]+/, "")
    .replace(/[\s,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) text = source;

  return {
    text,
    important,
    category,
    dueAt,
    remindEveryMinutes,
    askReminderClarification: asksReminders && !dueAt,
  };
}
