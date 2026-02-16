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
}

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
        content:
          "Ты парсер команд психотерапевта. Возвращай только JSON по схеме. Не добавляй комментарии. Русский язык. Не выдумывай данные.",
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
    if (primary) return primary;
  } catch {
    // fallback below
  }

  try {
    return await callModel(fallbackModel, text);
  } catch {
    return null;
  }
}
