import axios from "axios";

export type TherapistIntent =
  | "set_working_hours"
  | "create_appointment"
  | "suggest_slots"
  | "cancel_appointment"
  | "mark_done"
  | "daily_agenda"
  | "unknown";

export interface TherapistAction {
  intent: TherapistIntent;
  client_name?: string;
  start_datetime?: string;
  datetime_hint?: string;
  date?: string;
  type?: "session" | "homework" | "admin" | "other";
  notes?: string;
  days_of_week?: string[];
  start_time?: string;
  end_time?: string;
  timezone?: string;
  range?: "today" | "tomorrow" | "this_week" | "next_week" | "custom";
  from?: string;
  to?: string;
  limit?: number;
  target?: "next_appointment";
  confidenceOrReason?: string;
}

const SCHEDULE_KEYWORDS_RE =
  /(рабоч|график|часы|время\s+работы|расписан|по\s+будням|настро[йи]|установи\s+время|режим\s+работы)/i;
const TIME_TOKEN_RE = "(?:[01]?\\d|2[0-3])(?:[:.][0-5]\\d)?";
const TIME_RANGE_RE = new RegExp(
  `(${TIME_TOKEN_RE}\\s*[-–—]\\s*${TIME_TOKEN_RE})|(с\\s*${TIME_TOKEN_RE}\\s*до\\s*${TIME_TOKEN_RE})`,
  "i"
);
const DATETIME_CUE_RE =
  /(сегодня|завтра|послезавтра|пн|вт|ср|чт|пт|сб|вс|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b)/i;
const SLOT_KEYWORDS_RE = /(свободн\w*\s+слот|слоты|окна|когда\s+можно|подбери\s+слот|предложи\s+слот)/i;
const CREATE_VERBS_RE = /(запиши|запис[ьа]ть|создай\s+запись|поставь\s+запись|назначь\s+встречу)/i;

function normalizeWhitespaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function hasScheduleKeywords(text: string): boolean {
  return SCHEDULE_KEYWORDS_RE.test(text);
}

export function hasTimeRange(text: string): boolean {
  return TIME_RANGE_RE.test(text);
}

export function hasDatetimeCue(text: string): boolean {
  return DATETIME_CUE_RE.test(text);
}

export function hasClientLikeName(text: string): boolean {
  const cleaned = normalizeWhitespaces(text);
  const words = cleaned.match(/[\p{L}]{2,}/gu) ?? [];
  if (words.length < 2) return false;
  const uppercaseWords = words.filter((w) => w[0] === w[0]?.toUpperCase());
  return uppercaseWords.length >= 2 || words.length >= 3;
}

function hasSlotRequestKeywords(text: string): boolean {
  return SLOT_KEYWORDS_RE.test(text);
}

function hasCreateAppointmentVerb(text: string): boolean {
  return CREATE_VERBS_RE.test(text);
}

function extractDatetimeHint(text: string): string | undefined {
  const normalized = normalizeWhitespaces(text);
  const cueMatch = normalized.match(
    /(сегодня|завтра|послезавтра|пн|вт|ср|чт|пт|сб|вс|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)(?:\s+в)?(?:\s+(\d{1,2}:\d{2}))?/i
  );
  if (!cueMatch) return undefined;
  const dayPart = cueMatch[1] || "";
  const timePart = cueMatch[2] ? ` ${cueMatch[2]}` : "";
  const hint = `${dayPart}${timePart}`.trim();
  return hint || undefined;
}

export function applyDeterministicIntentGuards(text: string, action: TherapistAction): TherapistAction {
  const normalizedText = normalizeWhitespaces(text);
  const guarded: TherapistAction = { ...action };

  if (guarded.intent === "set_working_hours") {
    const hasScheduleSignal = hasScheduleKeywords(normalizedText) || hasTimeRange(normalizedText);
    const hasClientDateSignal = hasClientLikeName(normalizedText) && hasDatetimeCue(normalizedText);
    if (!hasScheduleSignal && hasClientDateSignal) {
      guarded.intent = "create_appointment";
      guarded.start_datetime = guarded.start_datetime || extractDatetimeHint(normalizedText);
      guarded.confidenceOrReason =
        "guard_override:set_working_hours->create_appointment(client_datetime_without_schedule_signals)";
      return guarded;
    }
  }

  if (guarded.intent === "create_appointment") {
    const hasSlotSignals = hasSlotRequestKeywords(normalizedText);
    if (hasSlotSignals && !hasCreateAppointmentVerb(normalizedText)) {
      guarded.intent = "suggest_slots";
      guarded.confidenceOrReason =
        "guard_override:create_appointment->suggest_slots(slot_keywords_without_create_verb)";
      return guarded;
    }
  }

  if (!guarded.confidenceOrReason) {
    guarded.confidenceOrReason = "model_output";
  }

  return guarded;
}

const NLU_SYSTEM_PROMPT = [
  "Ты парсер команд психотерапевта. Возвращай только JSON по схеме. Не добавляй комментарии. Русский язык. Не выдумывай данные.",
  "КРИТИЧЕСКИЕ ПРАВИЛА:",
  "1) intent=set_working_hours выбирай ТОЛЬКО если в тексте явно про рабочие часы/график/расписание ИЛИ есть явный диапазон времени (10:00-18:00, с 10:00 до 18:00).",
  "2) Если есть имя клиента (обычно 2+ слова) и дата/время записи (например: завтра 10:00), выбирай intent=create_appointment.",
  "3) Если пользователь просит предложить свободные слоты/окна (подбор вариантов), выбирай intent=suggest_slots. Не превращай это в create_appointment.",
  "4) Для suggest_slots не придумывай start_datetime конкретной записи.",
].join(" ");

const actionJsonSchema = {
  name: "therapist_action",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: {
        type: "string",
        enum: [
          "set_working_hours",
          "create_appointment",
          "suggest_slots",
          "cancel_appointment",
          "mark_done",
          "daily_agenda",
          "unknown",
        ],
      },
      client_name: { type: "string" },
      start_datetime: { type: "string" },
      datetime_hint: { type: "string" },
      date: { type: "string" },
      type: { type: "string", enum: ["session", "homework", "admin", "other"] },
      notes: { type: "string" },
      days_of_week: {
        type: "array",
        items: {
          type: "string",
          enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        },
      },
      start_time: { type: "string" },
      end_time: { type: "string" },
      timezone: { type: "string" },
      range: {
        type: "string",
        enum: ["today", "tomorrow", "this_week", "next_week", "custom"],
      },
      from: { type: "string" },
      to: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 20 },
      target: { type: "string", enum: ["next_appointment"] },
    },
    required: ["intent"],
  },
} as const;

function extractContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const out = content
      .map((chunk) => {
        if (!chunk || typeof chunk !== "object") return "";
        const maybeText = (chunk as { text?: unknown }).text;
        return typeof maybeText === "string" ? maybeText : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    return out;
  }
  return "";
}

function parseJsonSafely(raw: string): TherapistAction | null {
  const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as TherapistAction;
    if (!parsed || typeof parsed !== "object" || typeof parsed.intent !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function callModel(model: string, text: string): Promise<TherapistAction | null> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const referer = process.env.OPENROUTER_REFERER?.trim();
  const title = process.env.OPENROUTER_TITLE?.trim();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-Title"] = title;

  const payload = {
    model,
    response_format: {
      type: "json_schema",
      json_schema: actionJsonSchema,
    },
    messages: [
      {
        role: "system",
        content: NLU_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: text,
      },
    ],
    temperature: 0,
  };

  const response = await axios.post<{ choices?: Array<{ message?: { content?: unknown } }> }>(
    "https://openrouter.ai/api/v1/chat/completions",
    payload,
    { headers, timeout: 30_000 }
  );

  const content = extractContent(response.data?.choices?.[0]?.message?.content);
  return parseJsonSafely(content);
}

export async function nluParseCommand(text: string): Promise<TherapistAction | null> {
  const primaryModel = process.env.OPENROUTER_NLU_MODEL?.trim() || "nousresearch/hermes-2-pro-llama-3-8b";
  const fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL?.trim() || "meta-llama/llama-3.1-8b-instruct";

  try {
    const primary = await callModel(primaryModel, text);
    if (primary) return applyDeterministicIntentGuards(text, primary);
  } catch {
    // fallback below
  }

  try {
    const fallback = await callModel(fallbackModel, text);
    return fallback ? applyDeterministicIntentGuards(text, fallback) : null;
  } catch {
    return null;
  }
}
