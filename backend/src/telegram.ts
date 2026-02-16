import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { PrismaClient } from "@prisma/client";
import { processVoiceMessage } from "./services/transcription";
import {
  parseTherapistVoiceTranscript,
  normalizeClientName,
  parseTaskFromTranscript,
} from "./services/taskParser";
import { nluParseCommand } from "./services/therapistNlu";
import { ensureSettings, executeTherapistAction } from "./services/therapistExecutor";

const prisma = new PrismaClient();

type SettingsWizardStep =
  | "idle"
  | "menu"
  | "days"
  | "time_start"
  | "time_start_manual"
  | "time_end"
  | "time_end_manual"
  | "timezone"
  | "session_buffer"
  | "confirm";

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS: Record<(typeof DAY_ORDER)[number], string> = {
  mon: "Пн",
  tue: "Вт",
  wed: "Ср",
  thu: "Чт",
  fri: "Пт",
  sat: "Сб",
  sun: "Вс",
};
const TIME_START_OPTIONS = ["09:00", "10:00", "11:00", "12:00"];
const TIME_END_OPTIONS = ["17:00", "18:00", "19:00", "20:00"];
const TZ_OPTIONS = ["Asia/Bangkok", "Europe/Moscow", "UTC"] as const;

function encodeTimeForCallback(value: string): string {
  return value.replace(":", "-");
}

function decodeTimeFromCallback(value: string): string {
  return value.replace("-", ":");
}

function isValidHHMM(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value.trim());
}

async function getDraft(chatId: string) {
  const settings = await ensureSettings(prisma, chatId);
  return prisma.therapistSettingsDraft.upsert({
    where: { telegramChatId: chatId },
    update: {},
    create: {
      telegramChatId: chatId,
      step: "menu",
      selectedDays: settings.workDays,
      startTime: settings.workStart,
      endTime: settings.workEnd,
      timezone: settings.timezone,
      sessionMinutes: settings.sessionMinutes,
      bufferMinutes: settings.bufferMinutes,
    },
  });
}

async function resetDraft(chatId: string) {
  const settings = await ensureSettings(prisma, chatId);
  return prisma.therapistSettingsDraft.upsert({
    where: { telegramChatId: chatId },
    update: {
      step: "menu",
      selectedDays: settings.workDays,
      startTime: settings.workStart,
      endTime: settings.workEnd,
      timezone: settings.timezone,
      sessionMinutes: settings.sessionMinutes,
      bufferMinutes: settings.bufferMinutes,
    },
    create: {
      telegramChatId: chatId,
      step: "menu",
      selectedDays: settings.workDays,
      startTime: settings.workStart,
      endTime: settings.workEnd,
      timezone: settings.timezone,
      sessionMinutes: settings.sessionMinutes,
      bufferMinutes: settings.bufferMinutes,
    },
  });
}

function formatDays(days: string[]): string {
  const norm = DAY_ORDER.filter((d) => days.includes(d));
  if (!norm.length) return "не выбраны";
  return norm.map((d) => DAY_LABELS[d]).join(", ");
}

async function openSettingsMenu(ctx: Context, chatId: string): Promise<void> {
  const draft = await resetDraft(chatId);
  const text = [
    "Настройки расписания:",
    `• Дни: ${formatDays(draft.selectedDays)}`,
    `• Время: ${draft.startTime ?? "10:00"}–${draft.endTime ?? "18:00"}`,
    `• Таймзона: ${draft.timezone ?? "Asia/Bangkok"}`,
    `• Сессия/буфер: ${draft.sessionMinutes ?? 50}/${draft.bufferMinutes ?? 10} мин`,
  ].join("\n");

  await ctx.reply(text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Рабочие дни", callback_data: "settings:days" }],
        [{ text: "Рабочее время", callback_data: "settings:time:start" }],
        [{ text: "Таймзона", callback_data: "settings:timezone" }],
        [{ text: "Сессия/буфер", callback_data: "settings:session" }],
        [{ text: "Подтвердить", callback_data: "settings:confirm" }],
        [{ text: "Отмена", callback_data: "settings:cancel" }],
      ],
    },
  });
}

async function answerCallback(ctx: Context, text?: string): Promise<void> {
  const api = ctx as unknown as { answerCbQuery?: (t?: string) => Promise<void> };
  if (typeof api.answerCbQuery === "function") {
    await api.answerCbQuery(text);
  }
}

function getChatId(ctx: Context): string | null {
  const maybeChat = (ctx as unknown as { chat?: { id?: number | string } }).chat;
  if (!maybeChat || maybeChat.id == null) return null;
  return String(maybeChat.id);
}

function toInlineKeyboard(buttons: Array<{ text: string; callbackData: string }>) {
  const rows = buttons.map((b) => [{ text: b.text, callback_data: b.callbackData }]);
  return { inline_keyboard: rows } as const;
}

function createBot(): Telegraf {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  const bot = new Telegraf(token);

  bot.start(async (ctx: Context) => {
    try {
      const chatId = getChatId(ctx);
      if (chatId) {
        await ensureSettings(prisma, chatId);
      }
      await ctx.reply(
        "Готово. Отправьте голосом или текстом команду: запись, свободные слоты, отмена, рабочие часы."
      );
    } catch {
      await ctx.reply("Не удалось инициализировать настройки. Попробуйте позже.");
    }
  });

  bot.command("settings", async (ctx: Context) => {
    const chatId = getChatId(ctx);
    if (!chatId) {
      await ctx.reply("Не вижу чат для сохранения настроек.");
      return;
    }
    await openSettingsMenu(ctx, chatId);
  });

  bot.on(message("voice"), async (ctx: Context) => {
    try {
      const msg = ctx.message;
      if (!msg || !("voice" in msg)) {
        await ctx.reply("Голосовое сообщение не найдено.");
        return;
      }
      const voice = msg.voice;
      if (!voice) {
        await ctx.reply("Голосовое сообщение не найдено.");
        return;
      }
      const fileId = voice.file_id;
      if (!fileId) {
        await ctx.reply("Не удалось получить файл голосового сообщения.");
        return;
      }
      const transcript = await processVoiceMessage(bot, fileId);
      if (!transcript || transcript.trim().length === 0) {
        await ctx.reply("Не удалось распознать речь. Попробуйте ещё раз.");
        return;
      }

      const nluAction = await nluParseCommand(transcript);
      if (nluAction && nluAction.intent !== "unknown") {
        const result = await executeTherapistAction({
          prisma,
          action: nluAction,
          originalText: transcript,
          chatId: getChatId(ctx),
        });

        if (result.buttons && result.buttons.length > 0) {
          await ctx.reply(result.text, {
            reply_markup: toInlineKeyboard(result.buttons),
          });
        } else {
          await ctx.reply(result.text);
        }
        return;
      }

      let parsed = parseTherapistVoiceTranscript(transcript);
      if (!parsed.task.text || parsed.task.text.trim().length === 0) {
        parsed = { clientDisplayName: null, task: parseTaskFromTranscript(transcript) };
      }

      let clientId: string | null = null;
      if (parsed.clientDisplayName) {
        const normalizedName = normalizeClientName(parsed.clientDisplayName);
        if (normalizedName.length > 0) {
          const client = await prisma.client.upsert({
            where: { normalizedName },
            update: { displayName: parsed.clientDisplayName },
            create: {
              displayName: parsed.clientDisplayName,
              normalizedName,
            },
            select: { id: true },
          });
          clientId = client.id;
        }
      }

      const task = await prisma.task.create({
        data: {
          text: parsed.task.text,
          originalText: parsed.task.originalText,
          important: parsed.task.important,
          deadline: parsed.task.deadline,
          status: "active",
          clientId,
        },
      });
      const deadlineStr = task.deadline
        ? ` до ${task.deadline.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`
        : "";
      const clientPrefix = parsed.clientDisplayName ? `[${parsed.clientDisplayName}] ` : "";
      await ctx.reply(`Задача создана${deadlineStr}: ${clientPrefix}${task.text}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Voice message processing error:", msg);
      if (msg.includes("OPENROUTER_API_KEY") || msg.includes("OpenRouter")) {
        console.error("Check OPENROUTER_API_KEY and OpenRouter API availability.");
      }
      if (msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("Prisma")) {
        console.error("Check DATABASE_URL and database availability.");
      }
      await ctx.reply("Ошибка при обработке голосового сообщения. Попробуйте позже.");
    }
  });

  bot.on(message("text"), async (ctx: Context) => {
    try {
      const msg = ctx.message;
      if (!msg || !("text" in msg)) return;
      const text = msg.text?.trim();
      if (!text) return;

      const chatId = getChatId(ctx);
      if (chatId) {
        const draft = await prisma.therapistSettingsDraft.findUnique({
          where: { telegramChatId: chatId },
        });
        if (draft?.step === "time_start_manual" || draft?.step === "time_end_manual") {
          if (!isValidHHMM(text)) {
            await ctx.reply("Неверный формат. Введите время как HH:MM, например 10:30.");
            return;
          }
          if (draft.step === "time_start_manual") {
            await prisma.therapistSettingsDraft.update({
              where: { telegramChatId: chatId },
              data: { startTime: text, step: "time_end" },
            });
            await ctx.reply("Начало сохранено. Теперь выберите конец рабочего дня:", {
              reply_markup: {
                inline_keyboard: [
                  TIME_END_OPTIONS.map((value) => ({
                    text: value,
                    callback_data: `settings:time:end:set:${encodeTimeForCallback(value)}`,
                  })),
                  [{ text: "Ввести вручную", callback_data: "settings:time:end:manual" }],
                  [{ text: "Назад", callback_data: "settings:open" }],
                ],
              },
            });
            return;
          }

          await prisma.therapistSettingsDraft.update({
            where: { telegramChatId: chatId },
            data: { endTime: text, step: "confirm" },
          });
          await ctx.reply("Время сохранено. Перейдите к подтверждению.", {
            reply_markup: {
              inline_keyboard: [[{ text: "К подтверждению", callback_data: "settings:confirm" }]],
            },
          });
          return;
        }
      }

      if (text === "/settings" || /^настройки$/i.test(text)) {
        if (!chatId) {
          await ctx.reply("Не вижу чат для сохранения настроек.");
          return;
        }
        await openSettingsMenu(ctx, chatId);
        return;
      }

      const action = await nluParseCommand(text);
      if (!action || action.intent === "unknown") {
        return;
      }

      const result = await executeTherapistAction({
        prisma,
        action,
        originalText: text,
        chatId: getChatId(ctx),
      });

      if (result.buttons && result.buttons.length > 0) {
        await ctx.reply(result.text, {
          reply_markup: toInlineKeyboard(result.buttons),
        });
      } else {
        await ctx.reply(result.text);
      }
    } catch {
      await ctx.reply("Ошибка обработки команды. Попробуйте позже.");
    }
  });

  bot.on("callback_query", async (ctx: Context) => {
    try {
      const callback = (ctx as unknown as { callbackQuery?: { data?: string } }).callbackQuery;
      const data = callback?.data;
      if (!data) return;

      const chatId = getChatId(ctx);

      if (data.startsWith("settings:")) {
        if (!chatId) {
          await ctx.reply("Не вижу чат для сохранения настроек.");
          await answerCallback(ctx, "Нет chatId");
          return;
        }
        const draft = await getDraft(chatId);

        if (data === "settings:open") {
          await openSettingsMenu(ctx, chatId);
          await answerCallback(ctx, "Открыто");
          return;
        }

        if (data === "settings:days") {
          await prisma.therapistSettingsDraft.update({
            where: { telegramChatId: chatId },
            data: { step: "days" },
          });
          const rows = DAY_ORDER.map((d) => {
            const selected = draft.selectedDays.includes(d);
            return [{ text: `${selected ? "✅ " : ""}${DAY_LABELS[d]}`, callback_data: `settings:days:toggle:${d}` }];
          });
          rows.push([{ text: "Готово", callback_data: "settings:days:done" }]);
          rows.push([{ text: "Отмена", callback_data: "settings:cancel" }]);
          await ctx.reply(`Выберите рабочие дни. Сейчас: ${formatDays(draft.selectedDays)}`, {
            reply_markup: { inline_keyboard: rows },
          });
          await answerCallback(ctx, "Дни");
          return;
        }

        if (data.startsWith("settings:days:toggle:")) {
          const day = data.split(":")[3];
          if (DAY_ORDER.includes(day as (typeof DAY_ORDER)[number])) {
            const current = draft.selectedDays.includes(day)
              ? draft.selectedDays.filter((d: string) => d !== day)
              : [...draft.selectedDays, day];
            await prisma.therapistSettingsDraft.update({
              where: { telegramChatId: chatId },
              data: { selectedDays: current, step: "days" },
            });
          }
          await answerCallback(ctx, "Обновлено");
          return;
        }

        if (data === "settings:days:done") {
          const nextDraft = await getDraft(chatId);
          await ctx.reply(`Сделал: рабочие дни черновика ${formatDays(nextDraft.selectedDays)}.`);
          await openSettingsMenu(ctx, chatId);
          await answerCallback(ctx, "Готово");
          return;
        }

        if (data === "settings:time:start") {
          await prisma.therapistSettingsDraft.update({
            where: { telegramChatId: chatId },
            data: { step: "time_start" },
          });
          await ctx.reply("Выберите начало рабочего дня:", {
            reply_markup: {
              inline_keyboard: [
                TIME_START_OPTIONS.map((value) => ({
                  text: value,
                  callback_data: `settings:time:start:set:${encodeTimeForCallback(value)}`,
                })),
                [{ text: "Ввести вручную", callback_data: "settings:time:start:manual" }],
                [{ text: "Назад", callback_data: "settings:open" }],
              ],
            },
          });
          await answerCallback(ctx, "Старт");
          return;
        }

        if (data.startsWith("settings:time:start:set:")) {
          const encoded = data.split(":")[4] || "";
          const value = decodeTimeFromCallback(encoded);
          if (isValidHHMM(value)) {
            await prisma.therapistSettingsDraft.update({
              where: { telegramChatId: chatId },
              data: { startTime: value, step: "time_end" },
            });
          }
          await ctx.reply(`Сделал: начало дня ${value}. Теперь выберите конец рабочего дня:`, {
            reply_markup: {
              inline_keyboard: [
                TIME_END_OPTIONS.map((v) => ({
                  text: v,
                  callback_data: `settings:time:end:set:${encodeTimeForCallback(v)}`,
                })),
                [{ text: "Ввести вручную", callback_data: "settings:time:end:manual" }],
                [{ text: "Назад", callback_data: "settings:open" }],
              ],
            },
          });
          await answerCallback(ctx, "Сохранено");
          return;
        }

        if (data === "settings:time:start:manual") {
          await prisma.therapistSettingsDraft.update({
            where: { telegramChatId: chatId },
            data: { step: "time_start_manual" },
          });
          await ctx.reply("Введите начало дня в формате HH:MM (например 10:00).");
          await answerCallback(ctx, "Введите вручную");
          return;
        }

        if (data.startsWith("settings:time:end:set:")) {
          const encoded = data.split(":")[4] || "";
          const value = decodeTimeFromCallback(encoded);
          if (isValidHHMM(value)) {
            await prisma.therapistSettingsDraft.update({
              where: { telegramChatId: chatId },
              data: { endTime: value, step: "confirm" },
            });
          }
          await ctx.reply(`Сделал: конец дня ${value}. Проверьте итог и сохраните.`, {
            reply_markup: {
              inline_keyboard: [[{ text: "К подтверждению", callback_data: "settings:confirm" }]],
            },
          });
          await answerCallback(ctx, "Сохранено");
          return;
        }

        if (data === "settings:time:end:manual") {
          await prisma.therapistSettingsDraft.update({
            where: { telegramChatId: chatId },
            data: { step: "time_end_manual" },
          });
          await ctx.reply("Введите конец дня в формате HH:MM (например 18:00).");
          await answerCallback(ctx, "Введите вручную");
          return;
        }

        if (data === "settings:timezone") {
          await prisma.therapistSettingsDraft.update({
            where: { telegramChatId: chatId },
            data: { step: "timezone" },
          });
          await ctx.reply("Выберите таймзону:", {
            reply_markup: {
              inline_keyboard: [
                ...TZ_OPTIONS.map((tz) => [{ text: tz, callback_data: `settings:timezone:set:${tz.replace("/", "_")}` }]),
                [{ text: "Назад", callback_data: "settings:open" }],
              ],
            },
          });
          await answerCallback(ctx, "Таймзона");
          return;
        }

        if (data.startsWith("settings:timezone:set:")) {
          const token = data.split(":")[3] || "";
          const timezone = token.replace("_", "/");
          await prisma.therapistSettingsDraft.update({
            where: { telegramChatId: chatId },
            data: { timezone, step: "confirm" },
          });
          await ctx.reply(`Сделал: таймзона ${timezone}.`, {
            reply_markup: {
              inline_keyboard: [[{ text: "К подтверждению", callback_data: "settings:confirm" }]],
            },
          });
          await answerCallback(ctx, "Сохранено");
          return;
        }

        if (data === "settings:session") {
          await prisma.therapistSettingsDraft.update({
            where: { telegramChatId: chatId },
            data: { step: "session_buffer", sessionMinutes: 50, bufferMinutes: 10 },
          });
          await ctx.reply("Для MVP используется фикс: сессия 50 минут, буфер 10 минут.", {
            reply_markup: {
              inline_keyboard: [[{ text: "К подтверждению", callback_data: "settings:confirm" }]],
            },
          });
          await answerCallback(ctx, "MVP");
          return;
        }

        if (data === "settings:confirm") {
          const current = await getDraft(chatId);
          await prisma.therapistSettingsDraft.update({
            where: { telegramChatId: chatId },
            data: { step: "confirm" },
          });
          const text = [
            "Подтвердите сохранение:",
            `• Дни: ${formatDays(current.selectedDays)}`,
            `• Время: ${current.startTime ?? "10:00"}–${current.endTime ?? "18:00"}`,
            `• Таймзона: ${current.timezone ?? "Asia/Bangkok"}`,
            `• Сессия/буфер: ${current.sessionMinutes ?? 50}/${current.bufferMinutes ?? 10} мин`,
          ].join("\n");
          await ctx.reply(text, {
            reply_markup: {
              inline_keyboard: [
                [{ text: "Сохранить", callback_data: "settings:confirm:save" }],
                [{ text: "Отмена", callback_data: "settings:confirm:cancel" }],
              ],
            },
          });
          await answerCallback(ctx, "Проверьте");
          return;
        }

        if (data === "settings:confirm:save") {
          const current = await getDraft(chatId);
          await prisma.therapistSettings.upsert({
            where: { telegramChatId: chatId },
            update: {
              workDays: current.selectedDays.length ? current.selectedDays : ["mon", "tue", "wed", "thu", "fri"],
              workStart: current.startTime ?? "10:00",
              workEnd: current.endTime ?? "18:00",
              timezone: current.timezone ?? "Asia/Bangkok",
              sessionMinutes: current.sessionMinutes ?? 50,
              bufferMinutes: current.bufferMinutes ?? 10,
            },
            create: {
              telegramChatId: chatId,
              workDays: current.selectedDays.length ? current.selectedDays : ["mon", "tue", "wed", "thu", "fri"],
              workStart: current.startTime ?? "10:00",
              workEnd: current.endTime ?? "18:00",
              timezone: current.timezone ?? "Asia/Bangkok",
              sessionMinutes: current.sessionMinutes ?? 50,
              bufferMinutes: current.bufferMinutes ?? 10,
            },
          });
          await prisma.therapistSettingsDraft.delete({ where: { telegramChatId: chatId } }).catch(() => undefined);
          await ctx.reply(
            `Сделал: сохранил расписание (${formatDays(current.selectedDays)}, ${current.startTime ?? "10:00"}-${
              current.endTime ?? "18:00"
            }, ${current.timezone ?? "Asia/Bangkok"}).`
          );
          await answerCallback(ctx, "Сохранено");
          return;
        }

        if (data === "settings:confirm:cancel" || data === "settings:cancel") {
          await prisma.therapistSettingsDraft.delete({ where: { telegramChatId: chatId } }).catch(() => undefined);
          await ctx.reply("Сделал: мастер настроек отменен.");
          await answerCallback(ctx, "Отмена");
          return;
        }
      }

      if (data.startsWith("slot|")) {
        const [, clientId, startTsRaw] = data.split("|");
        const startTs = Number(startTsRaw);
        if (!clientId || !Number.isFinite(startTs)) {
          await ctx.reply("Не удалось создать запись из выбранного слота.");
          return;
        }

        const settings = await prisma.therapistSettings.findFirst({ orderBy: { createdAt: "asc" } });
        const sessionMinutes = settings?.sessionMinutes ?? 50;
        const startAt = new Date(startTs);
        const endAt = new Date(startAt.getTime() + sessionMinutes * 60_000);

        const appointment = await prisma.appointment.create({
          data: {
            clientId,
            startAt,
            endAt,
            kind: "session",
            status: "planned",
          },
          include: { client: { select: { displayName: true } } },
        });

        await ctx.reply(`Сделал: запись создана для ${appointment.client.displayName}.`);
        await (ctx as unknown as { answerCbQuery: (text?: string) => Promise<void> }).answerCbQuery("Готово");
        return;
      }

      if (data.startsWith("cancel_pick|")) {
        const [, appointmentId] = data.split("|");
        if (appointmentId) {
          await prisma.appointment.update({
            where: { id: appointmentId },
            data: { status: "canceled" },
          });
          await ctx.reply("Сделал: запись отменена.");
          await answerCallback(ctx, "Отменено");
        }
        return;
      }

      if (data.startsWith("cancel_yes|")) {
        const [, appointmentId] = data.split("|");
        if (appointmentId) {
          await prisma.appointment.update({
            where: { id: appointmentId },
            data: { status: "canceled" },
          });
          await ctx.reply("Сделал: запись отменена.");
          await answerCallback(ctx, "Отменено");
        }
        return;
      }

      if (data.startsWith("cancel_no|")) {
        await ctx.reply("Сделал: отмену не выполняю.");
        await answerCallback(ctx, "Оставили запись");
      }
    } catch {
      await ctx.reply("Ошибка обработки действия. Попробуйте позже.");
    }
  });

  return bot;
}

let botInstance: Telegraf | null = null;

export function getBot(): Telegraf {
  if (!botInstance) {
    botInstance = createBot();
  }
  return botInstance;
}

export function getWebhookCallback(): (req: import("express").Request, res: import("express").Response) => void | Promise<void> {
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET || undefined;
  return getBot().webhookCallback("/telegram/webhook", { secretToken }) as (req: import("express").Request, res: import("express").Response) => void | Promise<void>;
}
