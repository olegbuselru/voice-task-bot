import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { normalizeClientName } from "../services/taskParser";

const router = Router();
const prisma = new PrismaClient();

const taskInclude = {
  client: {
    select: {
      id: true,
      displayName: true,
      normalizedName: true,
    },
  },
} as const;

router.get("/tasks", async (_req: Request, res: Response): Promise<void> => {
  try {
    const tasks = await prisma.task.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: taskInclude,
    });
    res.status(200).json(tasks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("GET /tasks error:", msg);
    if (msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("Prisma")) {
      console.error("Database unavailable. Check DATABASE_URL.");
    }
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

router.get("/clients", async (_req: Request, res: Response): Promise<void> => {
  try {
    const clients = await prisma.client.findMany({
      orderBy: [{ displayName: "asc" }],
    });
    res.status(200).json(clients);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("GET /clients error:", msg);
    if (msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("Prisma")) {
      console.error("Database unavailable. Check DATABASE_URL.");
    }
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

router.get("/clients/:id/tasks", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tasks = await prisma.task.findMany({
      where: { clientId: id },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: taskInclude,
    });
    res.status(200).json(tasks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("GET /clients/:id/tasks error:", msg);
    if (msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("Prisma")) {
      console.error("Database unavailable. Check DATABASE_URL.");
    }
    res.status(500).json({ error: "Failed to fetch client tasks" });
  }
});

router.post("/tasks", async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      text,
      title,
      originalText,
      important,
      deadline,
      dueAt,
      clientId,
      clientName,
    } = req.body as {
      text?: unknown;
      title?: unknown;
      originalText?: unknown;
      important?: unknown;
      deadline?: unknown;
      dueAt?: unknown;
      clientId?: unknown;
      clientName?: unknown;
    };

    const rawText = typeof title === "string" && title.trim().length > 0 ? title : text;
    if (!rawText || typeof rawText !== "string" || rawText.trim().length === 0) {
      res.status(400).json({ error: "text/title is required and must be non-empty" });
      return;
    }

    let resolvedClientId: string | null = null;

    if (typeof clientId === "string" && clientId.trim().length > 0) {
      const existing = await prisma.client.findUnique({ where: { id: clientId.trim() } });
      if (!existing) {
        res.status(400).json({ error: "clientId does not exist" });
        return;
      }
      resolvedClientId = existing.id;
    } else if (typeof clientName === "string" && clientName.trim().length > 0) {
      const displayName = clientName.trim();
      const normalizedName = normalizeClientName(displayName);
      if (normalizedName.length > 0) {
        const upserted = await prisma.client.upsert({
          where: { normalizedName },
          update: { displayName },
          create: { displayName, normalizedName },
          select: { id: true },
        });
        resolvedClientId = upserted.id;
      }
    }

    const due = dueAt ?? deadline;
    const parsedDue = due != null ? new Date(String(due)) : null;
    const safeDue = parsedDue && !Number.isNaN(parsedDue.getTime()) ? parsedDue : null;

    const task = await prisma.task.create({
      data: {
        text: rawText.trim(),
        originalText: typeof originalText === "string" ? originalText.trim() : rawText.trim(),
        important: Boolean(important),
        deadline: safeDue,
        status: "active",
        clientId: resolvedClientId,
      },
      include: taskInclude,
    });
    res.status(201).json(task);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /tasks error:", msg);
    if (msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("Prisma")) {
      console.error("Database unavailable. Check DATABASE_URL.");
    }
    res.status(500).json({ error: "Failed to create task" });
  }
});

router.patch("/tasks/:id/complete", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const updated = await prisma.task.update({
      where: { id },
      data: { status: "completed", completedAt: new Date() },
      include: taskInclude,
    });
    res.status(200).json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("PATCH /tasks/:id/complete error:", msg);
    if (msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("Prisma")) {
      console.error("Database unavailable. Check DATABASE_URL.");
    }
    res.status(500).json({ error: "Failed to complete task" });
  }
});

router.patch("/tasks/:id/reopen", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const updated = await prisma.task.update({
      where: { id },
      data: { status: "active", completedAt: null },
      include: taskInclude,
    });
    res.status(200).json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("PATCH /tasks/:id/reopen error:", msg);
    if (msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("Prisma")) {
      console.error("Database unavailable. Check DATABASE_URL.");
    }
    res.status(500).json({ error: "Failed to reopen task" });
  }
});

export default router;
