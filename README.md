# Telegram Voice-to-Task System

Production-ready system: voice messages in Telegram → cloud transcription (OpenAI Whisper) → parsing (Russian time + "важно") → PostgreSQL → React SPA.

## Architecture

- **Telegram Bot** (webhook mode) receives voice messages.
- **Backend** (Node.js + Express) downloads voice (ogg/opus), converts to WAV via ffmpeg, transcribes with **OpenAI Whisper API**, parses with chrono-node (Russian), normalizes timezone (Europe/Moscow → UTC), stores in PostgreSQL.
- **Frontend** (React + Vite + Tailwind + Zustand) shows active/completed tasks, checkbox toggle, red highlight for important, deadline in Moscow time.

## Prerequisites

- Node.js 20+
- PostgreSQL
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- OpenAI API key (for speech-to-text)
- **ffmpeg** (for ogg → wav conversion before sending to OpenAI)

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
# Edit backend/.env: DATABASE_URL (PostgreSQL), TELEGRAM_*, OPENAI_API_KEY, FRONTEND_ORIGIN
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
OPENAI_API_KEY=sk-...
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

Open http://localhost:5173. Ensure `VITE_API_BASE_URL` points to the backend (e.g. `http://localhost:3000`). The app polls `GET /tasks` every 2 seconds.

## Migrations

- **Development:** `cd backend && npx prisma migrate dev`
- **Production:** `cd backend && npx prisma migrate deploy` (or run in Docker/startup)

## API

- `GET /health` — health check (200 OK).
- `GET /tasks` — list all tasks (JSON).
- `POST /tasks` — create task (body: `{ text, originalText?, important?, deadline? }`).
- `PATCH /tasks/:id/complete` — mark completed.
- `PATCH /tasks/:id/reopen` — reopen task.
- `POST /telegram/webhook` — Telegram webhook (do not call manually).

## Deploy to production

Backend must run 24/7 with PostgreSQL and OpenAI; frontend can be static. Two example setups.

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
     - `OPENAI_API_KEY`  
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
     - `OPENAI_API_KEY`  
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
| Backend     | `OPENAI_API_KEY`       | OpenAI API key for Whisper |
| Frontend    | `VITE_API_BASE_URL`     | Backend API URL (e.g. Render/Fly URL) |

## End-to-end flow

1. User sends a voice message to the Telegram bot.
2. Backend receives update at `POST /telegram/webhook` (validated with `secret_token`).
3. Bot gets `file_id`, downloads file, converts ogg → WAV (ffmpeg), sends to OpenAI Whisper API.
4. Transcript is parsed: "важно" → important; chrono-node (Russian) → deadline (Moscow, then UTC).
5. Task is saved to PostgreSQL.
6. User sees the task in the React app (polling every 2 s, active list, red highlight, deadline).
