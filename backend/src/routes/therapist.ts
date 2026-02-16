import { Request, Response, Router } from "express";
import { AppointmentKind, AppointmentStatus, PrismaClient } from "@prisma/client";
import { addDays, endOfDay, startOfDay } from "date-fns";
import { formatInTimeZone, zonedTimeToUtc } from "date-fns-tz";
import { getBot } from "../telegram";
import { normalizeClientName } from "../services/taskParser";
import { computeAvailabilitySlots } from "../services/scheduling";

const router = Router();
const prisma = new PrismaClient();
const DEFAULT_TIMEZONE = process.env.TZ?.trim() || "Asia/Bangkok";

function isValidTimezone(value: string | null | undefined): value is string {
  if (!value || !value.trim()) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

function safeTimezone(value: string | null | undefined): string {
  if (isValidTimezone(value)) return value.trim();
  return DEFAULT_TIMEZONE;
}

function parseDateValue(input: unknown): Date | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const parsed = new Date(input.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toAppointmentKind(input: unknown): AppointmentKind {
  if (input === "homework") return AppointmentKind.homework;
  if (input === "admin") return AppointmentKind.admin;
  if (input === "other") return AppointmentKind.other;
  return AppointmentKind.session;
}

function toAppointmentStatus(input: unknown): AppointmentStatus {
  if (input === "done") return AppointmentStatus.done;
  if (input === "canceled") return AppointmentStatus.canceled;
  return AppointmentStatus.planned;
}

async function resolveClientId(body: {
  clientId?: unknown;
  clientName?: unknown;
}): Promise<string | null> {
  if (typeof body.clientId === "string" && body.clientId.trim()) {
    const client = await prisma.client.findUnique({ where: { id: body.clientId.trim() } });
    return client?.id ?? null;
  }

  if (typeof body.clientName === "string" && body.clientName.trim()) {
    const displayName = body.clientName.trim();
    const normalizedName = normalizeClientName(displayName);
    if (!normalizedName) return null;
    const client = await prisma.client.upsert({
      where: { normalizedName },
      update: { displayName },
      create: { displayName, normalizedName },
      select: { id: true },
    });
    return client.id;
  }

  return null;
}

function getTodayRange(timezone: string): { from: Date; to: Date } {
  const tz = safeTimezone(timezone);
  const now = new Date();
  const dayKey = formatInTimeZone(now, tz, "yyyy-MM-dd");
  return {
    from: zonedTimeToUtc(`${dayKey}T00:00:00`, tz),
    to: zonedTimeToUtc(`${dayKey}T23:59:59`, tz),
  };
}

router.get("/settings", async (req: Request, res: Response): Promise<void> => {
  try {
    const chatId = typeof req.query.chatId === "string" ? req.query.chatId.trim() : undefined;
    const settings = chatId
      ? await prisma.therapistSettings.findUnique({ where: { telegramChatId: chatId } })
      : await prisma.therapistSettings.findFirst({ orderBy: { createdAt: "asc" } });

    if (!settings) {
      res.status(404).json({ error: "Settings not found" });
      return;
    }

    res.status(200).json(settings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("GET /settings error:", msg);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/settings", async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      telegramChatId,
      timezone,
      workDays,
      workStart,
      workEnd,
      sessionMinutes,
      bufferMinutes,
    } = req.body as Record<string, unknown>;

    if (typeof telegramChatId !== "string" || !telegramChatId.trim()) {
      res.status(400).json({ error: "telegramChatId is required" });
      return;
    }

    if (typeof timezone === "string" && timezone.trim() && !isValidTimezone(timezone.trim())) {
      res.status(400).json({ error: "timezone must be a valid IANA timezone" });
      return;
    }

    const updated = await prisma.therapistSettings.upsert({
      where: { telegramChatId: telegramChatId.trim() },
      update: {
        timezone: typeof timezone === "string" && timezone.trim() ? safeTimezone(timezone.trim()) : undefined,
        workDays: Array.isArray(workDays) ? workDays.filter((d): d is string => typeof d === "string") : undefined,
        workStart: typeof workStart === "string" ? workStart : undefined,
        workEnd: typeof workEnd === "string" ? workEnd : undefined,
        sessionMinutes: typeof sessionMinutes === "number" ? sessionMinutes : undefined,
        bufferMinutes: typeof bufferMinutes === "number" ? bufferMinutes : undefined,
      },
      create: {
        telegramChatId: telegramChatId.trim(),
        timezone: typeof timezone === "string" && timezone.trim() ? safeTimezone(timezone.trim()) : safeTimezone(process.env.TZ),
        workDays: Array.isArray(workDays)
          ? workDays.filter((d): d is string => typeof d === "string")
          : ["mon", "tue", "wed", "thu", "fri"],
        workStart: typeof workStart === "string" ? workStart : "10:00",
        workEnd: typeof workEnd === "string" ? workEnd : "18:00",
        sessionMinutes: typeof sessionMinutes === "number" ? sessionMinutes : 50,
        bufferMinutes: typeof bufferMinutes === "number" ? bufferMinutes : 10,
      },
    });

    res.status(200).json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("PUT /settings error:", msg);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

router.get("/appointments", async (req: Request, res: Response): Promise<void> => {
  try {
    const from = parseDateValue(req.query.from);
    const to = parseDateValue(req.query.to);
    const status = typeof req.query.status === "string" ? toAppointmentStatus(req.query.status) : undefined;
    const clientId = typeof req.query.clientId === "string" ? req.query.clientId.trim() : undefined;

    const appointments = await prisma.appointment.findMany({
      where: {
        startAt: {
          gte: from ?? undefined,
          lte: to ?? undefined,
        },
        status,
        clientId,
      },
      include: {
        client: {
          select: {
            id: true,
            displayName: true,
            normalizedName: true,
          },
        },
      },
      orderBy: [{ startAt: "asc" }],
    });

    res.status(200).json(appointments);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("GET /appointments error:", msg);
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
});

router.post("/appointments", async (req: Request, res: Response): Promise<void> => {
  try {
    const { startAt, endAt, status, kind, notes } = req.body as Record<string, unknown>;
    const clientId = await resolveClientId(req.body as { clientId?: unknown; clientName?: unknown });
    if (!clientId) {
      res.status(400).json({ error: "clientId or clientName is required" });
      return;
    }

    const parsedStart = parseDateValue(startAt);
    if (!parsedStart) {
      res.status(400).json({ error: "startAt is required and must be valid ISO date" });
      return;
    }

    const settings = await prisma.therapistSettings.findFirst({ orderBy: { createdAt: "asc" } });
    const sessionMinutes = settings?.sessionMinutes ?? 50;
    const safeEnd = parseDateValue(endAt) ?? new Date(parsedStart.getTime() + sessionMinutes * 60_000);

    const appointment = await prisma.appointment.create({
      data: {
        clientId,
        startAt: parsedStart,
        endAt: safeEnd,
        status: toAppointmentStatus(status),
        kind: toAppointmentKind(kind),
        notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
      },
      include: {
        client: {
          select: { id: true, displayName: true, normalizedName: true },
        },
      },
    });

    res.status(201).json(appointment);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /appointments error:", msg);
    res.status(500).json({ error: "Failed to create appointment" });
  }
});

router.patch("/appointments/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { startAt, endAt, status, kind, notes } = req.body as Record<string, unknown>;

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        startAt: parseDateValue(startAt) ?? undefined,
        endAt: parseDateValue(endAt) ?? undefined,
        status: typeof status === "string" ? toAppointmentStatus(status) : undefined,
        kind: typeof kind === "string" ? toAppointmentKind(kind) : undefined,
        notes: typeof notes === "string" ? notes : undefined,
      },
      include: {
        client: {
          select: { id: true, displayName: true, normalizedName: true },
        },
      },
    });

    res.status(200).json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("PATCH /appointments/:id error:", msg);
    res.status(500).json({ error: "Failed to update appointment" });
  }
});

router.delete("/appointments/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updated = await prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.canceled },
    });
    res.status(200).json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("DELETE /appointments/:id error:", msg);
    res.status(500).json({ error: "Failed to cancel appointment" });
  }
});

router.get("/availability", async (req: Request, res: Response): Promise<void> => {
  try {
    const settings = await prisma.therapistSettings.findFirst({ orderBy: { createdAt: "asc" } });
    if (!settings) {
      res.status(400).json({ error: "Working settings are not configured" });
      return;
    }

    const timezone = safeTimezone(settings.timezone);
    const from = parseDateValue(req.query.from) ?? startOfDay(new Date());
    const to = parseDateValue(req.query.to) ?? endOfDay(addDays(new Date(), 7));
    const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 8));

    const appointments = await prisma.appointment.findMany({
      where: {
        status: { not: AppointmentStatus.canceled },
        startAt: { gte: from, lte: to },
      },
      select: { startAt: true, endAt: true },
      orderBy: { startAt: "asc" },
    });

    const slots = computeAvailabilitySlots({
      from,
      to,
      settings: {
        timezone,
        workDays: settings.workDays,
        workStart: settings.workStart,
        workEnd: settings.workEnd,
        sessionMinutes: settings.sessionMinutes,
        bufferMinutes: settings.bufferMinutes,
      },
      appointments,
      limit,
    });

    res.status(200).json(slots);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("GET /availability error:", msg);
    res.status(500).json({ error: "Failed to calculate availability" });
  }
});

router.post("/cron/daily", async (req: Request, res: Response): Promise<void> => {
  try {
    const secret = process.env.CRON_SECRET?.trim();
    const incoming = (typeof req.query.secret === "string" ? req.query.secret : req.header("x-cron-secret"))?.trim();

    if (!secret || !incoming || incoming !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const allSettings = await prisma.therapistSettings.findMany({ orderBy: { createdAt: "asc" } });
    const bot = getBot();

    for (const settings of allSettings) {
      const range = getTodayRange(settings.timezone);
      const appointments = await prisma.appointment.findMany({
        where: {
          status: { not: AppointmentStatus.canceled },
          startAt: { gte: range.from, lte: range.to },
        },
        include: { client: { select: { displayName: true } } },
        orderBy: { startAt: "asc" },
      });

      const lines = appointments.map((item: { startAt: Date; client: { displayName: string } }) => {
        const hhmm = formatInTimeZone(item.startAt, settings.timezone, "HH:mm");
        return `${hhmm} — ${item.client.displayName}`;
      });

      const agendaText = lines.length
        ? `Повестка на сегодня:\n${lines.join("\n")}`
        : "Повестка на сегодня: записей нет.";

      await bot.telegram.sendMessage(settings.telegramChatId, agendaText);
    }

    res.status(200).json({ ok: true, delivered: allSettings.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /cron/daily error:", msg);
    res.status(500).json({ error: "Failed to send daily agenda" });
  }
});

export default router;
