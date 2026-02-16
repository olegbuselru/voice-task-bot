# Telegram Voice Task Bot (Therapist Mode)

Production-ready system: Telegram voice/text → OpenRouter transcription + NLU → deterministic scheduling/task execution → PostgreSQL → React SPA (board/list/calendar).

## Architecture

- **Telegram Bot** (webhook mode) receives voice messages.
- **Backend** (Node.js + Express) downloads voice (ogg/opus), converts to WAV via ffmpeg, transcribes via **OpenRouter**, parses therapist intents, computes availability deterministically, stores tasks/clients/appointments in PostgreSQL.
- **Frontend** (React + Vite + Tailwind + Zustand + dnd-kit) — anime-inspired task tracker: Board (Kanban), List, Calendar, voice add (Web Speech API), drag & drop, search, filters, toasts.

## Prerequisites

- Node.js 20+
- PostgreSQL
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- OpenRouter API key (for speech-to-text + NLU)
- **ffmpeg** (for ogg → wav conversion before sending to OpenRouter)

## Setup (local)

### 1. Install ffmpeg (macOS)

```bash
brew install ffmpeg
```

### 2. Clone and install

```bash
cd voice-task-bot
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Edit backend/.env: DATABASE_URL (PostgreSQL), TELEGRAM_*, OPENROUTER_*, CRON_SECRET, FRONTEND_ORIGIN
# Edit frontend/.env: VITE_API_BASE_URL=http://localhost:3000
```

### 3. Environment variables

**Backend (`backend/.env`)** — do not use local paths like `/Users/...`; use Postgres URL and env-only config:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/voice_task_db
TELEGRAM_BOT_TOKEN=<from BotFather>
TELEGRAM_WEBHOOK_SECRET=<random string for webhook verification>
BASE_URL=https://your-public-url.com
FRONTEND_ORIGIN=http://localhost:5173
OPENROUTER_API_KEY=<your-openrouter-api-key>
OPENROUTER_TRANSCRIBE_MODEL=<optional, e.g. openai/whisper-1>
OPENROUTER_NLU_MODEL=<optional>
OPENROUTER_FALLBACK_MODEL=<optional>
CRON_SECRET=<random-secret-for-/cron/daily>
```

**Frontend (`frontend/.env`)**:

```env
VITE_API_BASE_URL=http://localhost:3000
```

### 4. Database and migrations

```bash
cd backend
npm install
npx prisma migrate deploy
# or for first-time dev: npx prisma migrate dev --name init
npm run dev
```

### 5. Expose webhook locally (ngrok)

Telegram needs HTTPS. For local development:

```bash
ngrok http 3000
```

Use the `https://...` URL as `BASE_URL` and in the webhook setup below.

### 6. Set Telegram webhook

Replace `<YOUR_BOT_TOKEN>`, `<TELEGRAM_WEBHOOK_SECRET>` and the URL with your values:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-domain.com/telegram/webhook","secret_token":"<TELEGRAM_WEBHOOK_SECRET>"}'
```

To remove webhook:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/deleteWebhook"
```

### 7. Run frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Ensure `VITE_API_BASE_URL` points to the backend (e.g. `http://localhost:3000`). The app fetches on load, refetches on focus (if >60s since last fetch), auto-refreshes every 90s when tab is visible, and has a manual refresh button.

## Migrations

- **Development:** `cd backend && npx prisma migrate dev`
- **Production:** `cd backend && npx prisma migrate deploy` (or run in Docker/startup)

## API

- `GET /health` — health check (200 OK).
- `GET /tasks` — list all tasks (now may include optional `client`).
- `POST /tasks` — create task (compatible with `{ text }`, extended with `title`, `deadline|dueAt`, `clientId|clientName`).
- `PATCH /tasks/:id/complete` — mark completed.
- `PATCH /tasks/:id/reopen` — reopen task.
- `GET /clients` — list clients.
- `GET /clients/:id/tasks` — tasks for a specific client.
- `GET /appointments` — list appointments (`from`, `to`, `clientId`, `status`).
- `POST /appointments` — create appointment (`clientId` or `clientName`, `startAt`, optional `endAt`, `kind`, `notes`).
- `PATCH /appointments/:id` — update appointment.
- `DELETE /appointments/:id` — soft-cancel appointment.
- `GET /settings`, `PUT /settings` — therapist scheduling settings.
- `GET /availability` — computed free slots.
- `POST /cron/daily` — daily agenda sender (requires `CRON_SECRET`).
- `POST /telegram/webhook` — Telegram webhook (do not call manually).

## Deploy to production

Backend must run 24/7 with PostgreSQL and OpenRouter; frontend can be static. Two example setups.

### Scenario A: Render (backend) + Supabase (DB) + Vercel (frontend)

1. **Supabase (PostgreSQL)**  
   - Create project → Settings → Database → Connection string (URI).  
   - Use **Connection pooling** URI if Render uses it (e.g. port 6543).  
   - Set `DATABASE_URL` to this URI.

2. **Render (Backend)**  
   - New → Web Service → connect repo, root `voice-task-bot/backend` (or build from repo root with Dockerfile in `backend/`).  
   - Build: `npm ci && npx prisma generate && npm run build` (or use Dockerfile).  
   - Start: `npx prisma migrate deploy && node dist/server.js`.  
   - Env vars:
     - `DATABASE_URL` — Supabase connection string  
     - `TELEGRAM_BOT_TOKEN`  
     - `TELEGRAM_WEBHOOK_SECRET` — random secret (same as in webhook URL)  
     - `BASE_URL` — `https://<your-render-service>.onrender.com`  
     - `FRONTEND_ORIGIN` — `https://your-app.vercel.app` (no trailing slash)  
     - `OPENROUTER_API_KEY`
     - `OPENROUTER_TRANSCRIBE_MODEL` (optional)
     - `OPENROUTER_NLU_MODEL` (optional)
     - `OPENROUTER_FALLBACK_MODEL` (optional)
     - `CRON_SECRET`
   - After deploy, set Telegram webhook to `https://<your-render-service>.onrender.com/telegram/webhook` with the same `secret_token`.

3. **Vercel (Frontend)**  
   - Import repo, root `voice-task-bot/frontend`.  
   - Env var: `VITE_API_BASE_URL=https://<your-render-service>.onrender.com`  
   - Build and deploy.

### Scenario B: Fly.io (backend) + Neon (DB) + Vercel (frontend)

1. **Neon (PostgreSQL)**  
   - Create project → Connection string.  
   - Set `DATABASE_URL` (use pooled connection string if Neon suggests it).

2. **Fly.io (Backend)**  
   - In repo: `fly launch` (or create app), set Dockerfile path to `backend/Dockerfile` (or build from `backend/`).  
   - Env vars (e.g. `fly secrets set` or dashboard):
     - `DATABASE_URL` — Neon connection string  
     - `TELEGRAM_BOT_TOKEN`  
     - `TELEGRAM_WEBHOOK_SECRET`  
     - `BASE_URL` — `https://<your-app>.fly.dev`  
     - `FRONTEND_ORIGIN` — `https://your-app.vercel.app`  
     - `OPENROUTER_API_KEY`
     - `OPENROUTER_TRANSCRIBE_MODEL` (optional)
     - `OPENROUTER_NLU_MODEL` (optional)
     - `OPENROUTER_FALLBACK_MODEL` (optional)
     - `CRON_SECRET`
   - Dockerfile already runs `prisma migrate deploy` before `node dist/server.js`.  
   - Deploy, then set Telegram webhook to `https://<your-app>.fly.dev/telegram/webhook` with the same `secret_token`.

3. **Vercel (Frontend)**  
   - Same as in A: `VITE_API_BASE_URL=https://<your-app>.fly.dev`.

### Setting Telegram webhook on production

After backend is live at a public HTTPS URL:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://YOUR_BACKEND_URL/telegram/webhook","secret_token":"YOUR_TELEGRAM_WEBHOOK_SECRET"}'
```

Use the same `TELEGRAM_WEBHOOK_SECRET` as in backend env. Telegram will send `X-Telegram-Bot-Api-Secret-Token` and the backend will only accept requests that match.

### Env vars summary

| Where        | Variable                | Description |
|-------------|-------------------------|-------------|
| Backend     | `DATABASE_URL`          | PostgreSQL connection string |
| Backend     | `TELEGRAM_BOT_TOKEN`    | From BotFather |
| Backend     | `TELEGRAM_WEBHOOK_SECRET` | Secret for webhook verification |
| Backend     | `BASE_URL`              | Public HTTPS URL of the backend |
| Backend     | `FRONTEND_ORIGIN`       | Allowed CORS origin (e.g. Vercel URL) |
| Backend     | `OPENROUTER_API_KEY`   | OpenRouter API key |
| Backend     | `OPENROUTER_TRANSCRIBE_MODEL` | Optional override for transcription model |
| Backend     | `OPENROUTER_NLU_MODEL` | Optional override for NLU model |
| Backend     | `OPENROUTER_FALLBACK_MODEL` | Optional fallback model |
| Backend     | `CRON_SECRET`          | Secret for `POST /cron/daily` |
| Frontend    | `VITE_API_BASE_URL`     | Backend API URL (e.g. `https://voice-task-bot-backend.onrender.com` — no trailing slash) |

## End-to-end flow

1. User sends a voice message to the Telegram bot.
2. Backend receives update at `POST /telegram/webhook` (validated with `secret_token`).
3. Bot gets `file_id`, downloads file, converts ogg → WAV (ffmpeg), sends for OpenRouter transcription.
4. Transcript/text is passed to therapist NLU for intent/entity parsing.
5. Backend executes action:
   - appointment create/suggest/cancel/mark-done, or
   - settings update (working hours), or
   - fallback to legacy task creation.
6. Data is stored in PostgreSQL; frontend displays unified cards in Board/List/Calendar.

### Frontend checklist (browser testing)

- Today agenda: today-only appointments sorted by time with quick actions (Done/Cancel)
- Board: Kanban columns (Planned, Done, Canceled), drag cards between columns and reorder
- List: table view, filters, reorder, and explicit status badge
- Calendar: month/week/day, tasks with deadline and distinct styling for canceled/done
- Add task: button + hotkey `N`, form (title, notes, due date, priority, column)
- Voice add: mic button, SpeechRecognition (Chrome/Edge), fallback in Safari/Firefox
- Search and filters (status, priority, overdue, today, date range)
- Client filter (All clients + per-client scope)
- Toast notifications on success/error
