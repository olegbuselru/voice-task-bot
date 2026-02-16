# AGENTS

## Current architecture

- **Monorepo**: `backend/` + `frontend/`.
- **Backend**: Node.js + TypeScript + Express + Prisma.
  - Core endpoints: `GET /health`, `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id/complete`, `PATCH /tasks/:id/reopen`.
  - Telegram webhook endpoint: `POST /telegram/webhook`.
  - Voice pipeline: Telegram voice file -> ffmpeg conversion -> OpenRouter transcription -> task parsing -> DB write.
- **Frontend**: Vite + React + TypeScript + Zustand.
  - Views: board/list/calendar.
  - API base URL from `VITE_API_BASE_URL` with production fallback.

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

### Migration

- Migration folder: `backend/prisma/migrations/20260216090000_add_clients_therapist_mode/`
- Adds `Client` table, unique index on `normalizedName`, nullable `Task.clientId`, index on `Task.clientId`, FK `Task.clientId -> Client.id`.

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
- `POST /tasks` extended body support:
  - `text` or `title` (required, one of them)
  - `deadline` or `dueAt` (optional)
  - `clientId` (optional) or `clientName` (optional)
  - If `clientName` is provided and not found, backend upserts a client by `normalizedName`.

### Telegram therapist voice behavior

- Parses transcript as: `<Client Full Name> <task text with optional date/time>`.
- Upserts client when client name is detected.
- Creates task linked to client.
- Safe fallback: if therapist parse is unusable, creates task from regular transcript parsing without client link.

## Known pitfalls

- Prisma client must be regenerated after schema changes: `npm -C backend run db:generate`.
- Deploy must run migrations before backend start in production.
- Voice parser expects at least two leading name tokens for client extraction; otherwise task is treated as generic.
- Existing historical tasks may have `clientId = null`; frontend should use "All clients" to see full history.
- For frontend local build reliability, run in frontend cwd (`npm ci --include=dev && npm run build`) to ensure `vite` binary resolution.
