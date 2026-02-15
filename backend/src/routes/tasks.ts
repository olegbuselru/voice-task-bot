import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

router.get("/tasks", async (_req: Request, res: Response): Promise<void> => {
  try {
    const tasks = await prisma.task.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
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

router.post("/tasks", async (req: Request, res: Response): Promise<void> => {
  try {
    const { text, originalText, important, deadline } = req.body;
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: "text is required and must be non-empty" });
      return;
    }
    const task = await prisma.task.create({
      data: {
        text: text.trim(),
        originalText: typeof originalText === "string" ? originalText.trim() : text.trim(),
        important: Boolean(important),
        deadline: deadline != null ? new Date(deadline) : null,
        status: "active",
      },
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
