export const APP_TIMEZONE = "Europe/Moscow";

export interface AppConfig {
  port: number;
  telegramBotToken: string;
  cronSecret: string;
  openRouterApiKey?: string;
  openRouterAudioModel: string;
  openRouterReferer?: string;
  openRouterTitle?: string;
}

export function loadConfig(): AppConfig {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  if (!cronSecret) {
    throw new Error("CRON_SECRET is required");
  }

  return {
    port: Number(process.env.PORT || 3000),
    telegramBotToken,
    cronSecret,
    openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim(),
    openRouterAudioModel: process.env.OPENROUTER_AUDIO_MODEL?.trim() || "openai/gpt-4o-mini-transcribe",
    openRouterReferer: process.env.OPENROUTER_REFERER?.trim(),
    openRouterTitle: process.env.OPENROUTER_TITLE?.trim(),
  };
}
