import express from "express";
import cors from "cors";
import { getWebhookCallback } from "./telegram";
import tasksRoutes from "./routes/tasks";
import therapistRoutes from "./routes/therapist";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const frontendOrigin = process.env.FRONTEND_ORIGIN;
const corsOptions = frontendOrigin
  ? { origin: frontendOrigin.split(",").map((o) => o.trim()).filter(Boolean) }
  : { origin: true };
app.use(cors(corsOptions));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/telegram/webhook", (req, res, next) => {
  const callback = getWebhookCallback();
  Promise.resolve(callback(req, res)).catch(next);
});

app.use("/", tasksRoutes);
app.use("/", therapistRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err?.message ?? err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
