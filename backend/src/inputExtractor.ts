import { TelegramUpdate } from "./types";

export interface ExtractedUserInput {
  chatId: string;
  userText: string | null;
  messageId: number | null;
  type: "text" | "caption" | "voice_transcript" | "audio_transcript" | "document_transcript" | "unknown";
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function extractUserInput(update: TelegramUpdate): ExtractedUserInput | null {
  const message = update.message;
  const chatIdRaw = message?.chat?.id;
  if (chatIdRaw == null) {
    return null;
  }

  const chatId = String(chatIdRaw);
  const messageId = typeof message?.message_id === "number" ? message.message_id : null;

  const text = asText(message?.text);
  if (text) {
    return { chatId, userText: text, messageId, type: "text" };
  }

  const caption = asText(message?.caption);
  if (caption) {
    return { chatId, userText: caption, messageId, type: "caption" };
  }

  const voiceTranscript = asText(message?.voice?.transcript);
  if (voiceTranscript) {
    return { chatId, userText: voiceTranscript, messageId, type: "voice_transcript" };
  }

  const audioTranscript = asText(message?.audio?.transcript);
  if (audioTranscript) {
    return { chatId, userText: audioTranscript, messageId, type: "audio_transcript" };
  }

  const documentTranscript = asText(message?.document?.transcript);
  if (documentTranscript) {
    return { chatId, userText: documentTranscript, messageId, type: "document_transcript" };
  }

  return { chatId, userText: null, messageId, type: "unknown" };
}
