const chronoRu = require("chrono-node/ru") as {
  parse: (text: string) => Array<{ start: { get: (c: string) => number | undefined; isCertain: (c: string) => boolean } }>;
  parseDate: (text: string) => Date | null;
};

const MOSCOW_OFFSET = "+03:00";
const DEFAULT_HOUR = 9;
const DEFAULT_MINUTE = 0;
const DEFAULT_SECOND = 0;

export interface ParsedTask {
  text: string;
  originalText: string;
  important: boolean;
  deadline: Date | null;
}

/**
 * Detect if task is marked as important (Russian "важно").
 */
export function detectImportant(transcript: string): boolean {
  if (!transcript || typeof transcript !== "string") {
    return false;
  }
  return transcript.toLowerCase().includes("важно");
}

/**
 * Extract deadline from Russian text using chrono-node (Russian locale).
 * Assumes Europe/Moscow. If time is missing, defaults to 09:00 Moscow.
 * Returns UTC Date or null if no date found.
 */
export function extractDeadline(transcript: string): Date | null {
  if (!transcript || typeof transcript !== "string") {
    return null;
  }
  try {
    const results = chronoRu.parse(transcript);
    if (!results.length || !results[0]) {
      return null;
    }
    const comp = results[0].start;
    const y = comp.get("year");
    const m = comp.get("month");
    const d = comp.get("day");
    if (y == null || m == null || d == null) {
      return null;
    }
    const hasTime = comp.isCertain("hour") || comp.isCertain("minute");
    const h = hasTime ? (comp.get("hour") ?? DEFAULT_HOUR) : DEFAULT_HOUR;
    const min = hasTime ? (comp.get("minute") ?? DEFAULT_MINUTE) : DEFAULT_MINUTE;
    const sec = hasTime ? (comp.get("second") ?? DEFAULT_SECOND) : DEFAULT_SECOND;
    const pad = (n: number) => String(n).padStart(2, "0");
    const monthVal = Math.min(12, Math.max(1, Number(m) || 1));
    const dayVal = Math.min(31, Math.max(1, Number(d) || 1));
    const isoMoscow = `${y}-${pad(monthVal)}-${pad(dayVal)}T${pad(h)}:${pad(min)}:${pad(sec)}${MOSCOW_OFFSET}`;
    const utc = new Date(isoMoscow);
    if (Number.isNaN(utc.getTime())) {
      return null;
    }
    return utc;
  } catch {
    return null;
  }
}

/**
 * Normalize transcript to task text (e.g. strip "важно" and date phrases if desired).
 * For now we keep full transcript as both text and originalText; text can be cleaned later.
 */
function normalizeText(transcript: string): string {
  return transcript.trim();
}

/**
 * Parse voice transcript into task fields: text, originalText, important, deadline (UTC).
 */
export function parseTaskFromTranscript(transcript: string): ParsedTask {
  if (!transcript || typeof transcript !== "string") {
    throw new Error("Transcript is required and must be a non-empty string");
  }
  const trimmed = transcript.trim();
  if (trimmed.length === 0) {
    throw new Error("Transcript cannot be empty");
  }
  const important = detectImportant(trimmed);
  const deadline = extractDeadline(trimmed);
  const text = normalizeText(trimmed);
  return {
    text,
    originalText: trimmed,
    important,
    deadline,
  };
}
