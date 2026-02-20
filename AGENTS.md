# AGENTS

## Update (2026-02-20) — Telegram-only backend rebuild

- Backend was rebuilt for a **Telegram-only task reminder product**.
- Canonical backend surface now:
  - `GET /health`
  - `POST /telegram/webhook`
  - `POST /cron/tick` (Bearer `CRON_SECRET`)
  - `POST /cron/daily` (Bearer `CRON_SECRET`)
  - `GET /tasks?chatId=...` (debug)
- Canonical timezone is **Europe/Moscow**.
- Prisma models now centered on:
  - `Task` (`active|boxed|completed|canceled`, `dueAt`, `remindEveryMinutes`, `nextReminderAt`)
  - `ProcessedUpdate` for webhook idempotency (`chatId+updateId` unique)
  - `SentReminder` for reminder dedupe (`taskId+scheduledAt` unique)
- Reminder delivery is cron-driven (no in-memory scheduler as a single source of truth).
- Voice transcription remains optional via OpenRouter audio envs; text flow must remain operational without it.

> Note: historical sections below describe the previous therapist-mode architecture and are kept only as archive context.

## Current architecture

- **Monorepo**: `backend/` + `frontend/`.
- **Backend**: Node.js + TypeScript + Express + Prisma.
  - Core endpoints: `GET /health`, `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id/complete`, `PATCH /tasks/:id/reopen`.
  - Therapist endpoints: `GET/PUT /settings`, `GET/POST /appointments`, `PATCH/DELETE /appointments/:id`, `GET /availability`, `POST /cron/daily`.
  - Telegram webhook endpoint: `POST /telegram/webhook`.
  - Voice pipeline: Telegram voice file -> ffmpeg conversion -> OpenRouter transcription -> NLU parse -> therapist executor or legacy task fallback.
- **Frontend**: Vite + React + TypeScript + Zustand.
  - Views: today/board/list/calendar.
  - API base URL from `VITE_API_BASE_URL` with production fallback.
  - Store now reads therapist appointments and maps them into UI task cards/rows/events.

## Therapist-mode data model

### Prisma models

- `Client`
  - `id` (uuid)
  - `displayName` (string)
  - `normalizedName` (string, unique)
  - `createdAt` (datetime)
- `Task` (existing)
  - Added `clientId` (nullable)
  - Relation `client` -> `Client` with `onDelete: SetNull`
  - Existing tasks remain valid without a linked client.
- `Appointment`
  - `id` (uuid)
  - `clientId` (FK -> Client)
  - `startAt`, `endAt` (datetime)
  - `status` (planned|done|canceled)
  - `kind` (session|homework|admin|other)
  - `notes` (nullable string)
  - `createdAt`
- `TherapistSettings`
  - `telegramChatId` (unique)
  - `timezone` (default `Asia/Bangkok`)
  - `workDays` (array mon..sun)
  - `workStart`, `workEnd` (`HH:MM`)
  - `sessionMinutes` (default 50)
  - `bufferMinutes` (default 10)
  - `createdAt`, `updatedAt`

### Migration

- Migration folder: `backend/prisma/migrations/20260216090000_add_clients_therapist_mode/`
- Adds `Client` table, unique index on `normalizedName`, nullable `Task.clientId`, index on `Task.clientId`, FK `Task.clientId -> Client.id`.
- Migration folder: `backend/prisma/migrations/20260216103000_add_appointments_settings/`
- Adds enums `AppointmentStatus`, `AppointmentKind`, table `Appointment`, table `TherapistSettings` and required indexes/FK.

## API contract (therapist mode)

### Existing endpoints (preserved)

- `GET /tasks` -> now includes optional `client` object.
- `POST /tasks` -> backward compatible with existing `text` payload.
- `PATCH /tasks/:id/complete`, `PATCH /tasks/:id/reopen` -> now return task with optional `client`.

### New/extended endpoints

- `GET /clients`
  - Returns all clients sorted by display name.
- `GET /clients/:id/tasks`
  - Returns tasks for one client.
- `GET /appointments`
  - Supports filters: `from`, `to`, `clientId`, `status`.
- `POST /appointments`
  - Creates appointment (supports `clientId` or `clientName`).
- `PATCH /appointments/:id`
  - Updates status/time/kind/notes.
- `DELETE /appointments/:id`
  - Soft-cancels appointment (`status=canceled`).
- `GET /availability`
  - Computes deterministic free slots from settings + current appointments.
- `POST /cron/daily`
  - Protected by `CRON_SECRET` (query `secret` or header `x-cron-secret`), sends daily agenda to registered chats.
- `POST /tasks` extended body support:
  - `text` or `title` (required, one of them)
  - `deadline` or `dueAt` (optional)
  - `clientId` (optional) or `clientName` (optional)
  - If `clientName` is provided and not found, backend upserts a client by `normalizedName`.

### Telegram therapist voice behavior

- Parses transcript as: `<Client Full Name> <task text with optional date/time>`.
- Uses OpenRouter NLU (`OPENROUTER_NLU_MODEL`, fallback `OPENROUTER_FALLBACK_MODEL`) to parse intents.
- Applies deterministic post-guards after NLU parse:
  - `set_working_hours -> create_appointment` when text has client+datetime cues but no schedule keywords/time-range.
  - `create_appointment -> suggest_slots` when text asks for free slots without explicit create verbs.
- Supports intents: create appointment, suggest slots (inline buttons), cancel with disambiguation pick-buttons, set working hours, mark done.
- `/start` stores `telegramChatId` via settings bootstrap.
- Voice flow keeps safe fallback to legacy `Task` creation when NLU is unknown/unusable.
- Telegram entrypoint logs compact NLU traces (`tag:"nlu"`, text, intent, extracted fields, guard/model reason).

## Known pitfalls

- Prisma client must be regenerated after schema changes: `npm -C backend run db:generate`.
- Deploy must run migrations before backend start in production.
- Availability is code-driven (buffer/session logic), LLM only parses text intents.
- `/availability` returns 404 on currently deployed prod until new backend commit is deployed.
- Cron delivery depends on external scheduler pinging `/cron/daily` at 09:00 Bangkok with `CRON_SECRET`.
- Existing historical tasks may have `clientId = null`; frontend should use "All clients" to see full history.
- For frontend local build reliability, run in frontend cwd (`npm ci --include=dev && npm run build`) to ensure `vite` binary resolution.
- Historical bad appointments created before the guard fix (e.g. slot-request notes or wrong historical dates) remain in DB and should be cleaned manually if needed.

## Current status (2026-02-16)

- ✅ Telegram settings wizard implemented with persistent DB draft state (`TherapistSettingsDraft`) and inline callback flow.
- ✅ Cancel intent now supports disambiguation: when multiple appointments match, bot shows pick-buttons and cancels exact selected appointment.
- ✅ Frontend now treats `canceled` as dedicated status across board/list/calendar and includes a dedicated **Today agenda** view with quick actions.
- ✅ Frontend routing migrated to BrowserRouter path routes: `/today`, `/board`, `/list`, `/calendar`.
- ✅ Render SPA deep links configured via `frontend/public/_redirects` and root `render.yaml` rewrite.
- ✅ Therapist NLU misrouting fix shipped: client+datetime messages no longer fall into `set_working_hours`.
- ✅ `suggest_slots` safety guard shipped: slot-search phrasing is rerouted away from `create_appointment`.
- ✅ Added backend regression script `npm -C backend run test:nlu-regression` for deterministic intent checks.

## Next steps

- Deploy backend with the new Prisma migration `20260216124500_add_therapist_settings_draft`.
- Redeploy frontend static site so deep links and today agenda are available in production.
- Run end-to-end Telegram checks in production webhook chat: `/settings` wizard, ambiguous cancel pick, NLU guard traces, and daily agenda visibility.
