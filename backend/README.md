# Backend: Minimal Telegram Reminder Bot

This backend is intentionally minimal and production-ready for Render.

## Features

- `GET /health` -> `200 {"status":"ok"}`
- `POST /telegram/webhook` -> receives Telegram updates and schedules reminders
- `POST /cron/tick` -> protected cron endpoint to deliver due reminders
- Owner debug command: `/tick` (works only for `OWNER_CHAT_ID`)
- Persistent storage in PostgreSQL via Prisma (survives restarts/sleep)
- Moscow timezone logic (`Europe/Moscow`) for parsing reminder commands
- Text commands in chat:
  - `Коробка` (last sent reminders)
  - `Все задачи` (future scheduled, tomorrow+)
  - `Что сегодня` (today scheduled)

## Supported reminder commands (Russian)

1. `напомни завтра полить цветок` (defaults to 10:00 MSK)
2. `напомни завтра в 09:30 позвонить маме`
3. `напомни сегодня в 21:30 выключить плиту`

If parsing fails, bot sends these examples.

## Required environment variables

Use placeholders only (do not commit real values):

- `DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME`
- `TELEGRAM_BOT_TOKEN=BOT_TOKEN`
- `CRON_SECRET=CRON_SECRET_VALUE`
- `OWNER_CHAT_ID=123456789` (optional, enables `/tick`)
- `PORT=3000` (optional locally; Render provides it)

## Local run

```bash
npm -C backend ci
npm -C backend run db:generate
npm -C backend run build
npm -C backend run db:migrate:deploy
npm -C backend run start
```

## Set Telegram webhook

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<backend-url>/telegram/webhook"}'
```

## External cron (every minute)

Configure GitHub Actions, cron-job.org, or similar to call:

- `POST https://<backend-url>/cron/tick`
- Header: `Authorization: Bearer <CRON_SECRET_VALUE>`

Example:

```bash
curl -X POST "https://<backend-url>/cron/tick" \
  -H "Authorization: Bearer <CRON_SECRET_VALUE>"
```

If cron is not configured, reminders are created but will not be auto-delivered until `/cron/tick` is called.

## Render deployment

- Build command: `npm ci && npx prisma generate && npm run build`
- Start command: `npx prisma migrate deploy && node dist/server.js`
- Ensure env vars above are configured in Render service settings.
