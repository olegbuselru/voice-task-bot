# DECISIONS

## 2026-02-23 — Reset backend to minimal Telegram reminder bot

- Replaced therapist/task scheduler logic with a minimal reminder-only backend.
- Canonical API reduced to `GET /health`, `POST /telegram/webhook`, `POST /cron/tick`.
- Reminder persistence is Prisma/PostgreSQL-first to survive restarts and Render sleep.
- Time parsing is fixed to `Europe/Moscow` and supports only three explicit Russian command patterns.
- Reminder dispatch is external-cron driven (`/cron/tick`) instead of in-process timers.
- Webhook idempotency is enforced via `ProcessedUpdate.id = update_id` primary key.

## 2026-02-16 — Therapist MVP: separate Appointment model (keep Task compatibility)

- Added dedicated `Appointment` + `TherapistSettings` models instead of overloading `Task`.
- Kept `/tasks` endpoints backward-compatible for existing flows and historical data.
- Frontend maps appointments into existing board/list/calendar UI task primitives to avoid full UI rewrite.

## 2026-02-16 — NLU split from deterministic scheduling

- OpenRouter text models are used only for intent/entity parsing (`nluParseCommand`).
- Slot computation is deterministic in backend code (`computeAvailabilitySlots`) with:
  - working-day windows from settings
  - 50-minute session length (configurable)
  - 10-minute mandatory buffer (configurable)
  - 10-minute slot step
- This prevents oversized callback payloads and survives process restarts/sleep.

## 2026-02-16 — Telegram action UX

- `/start` bootstraps `telegramChatId` into `TherapistSettings`.
- Voice/text commands go through NLU first; if not recognized, voice falls back to legacy task parser.
- Slot suggestions use inline buttons; cancel uses disambiguation pick-buttons when multiple matches are found.

## 2026-02-20 — Backend rebuilt as Telegram-only reminder scheduler

- Replaced therapist appointment backend with Telegram-only task reminder system.
- New core models: `Task`, `ProcessedUpdate`, `SentReminder`.
- Webhook idempotency is enforced by unique `(chatId, updateId)`.
- Reminder reliability is cron-driven (`/cron/tick`) instead of in-memory timers.
- Daily digest is cron-driven (`/cron/daily`) at 09:00 Europe/Moscow.
- Reminder dedupe is enforced by unique `(taskId, scheduledAt)` in `SentReminder`.
- Voice remains optional via OpenRouter audio; text flow works without audio envs.

## 2026-02-16 — Telegram scheduler UX state persisted in DB

- `/start` bootstraps `telegramChatId` into `TherapistSettings`.
- Voice/text commands go through NLU first; if not recognized, voice falls back to legacy task parser.
- Slot suggestions use inline buttons; cancel uses disambiguation pick-buttons when multiple matches are found.

## 2026-02-16 — Deterministic post-guards for therapist intents

- Added a post-NLU deterministic guard layer before execution to reduce high-cost intent mistakes.
- Guard 1: reroute `set_working_hours -> create_appointment` when message has client+datetime cues but no schedule keywords/time-range.
- Guard 2: reroute `create_appointment -> suggest_slots` when message asks for free slots/availability without explicit create verbs.
- Added compact NLU trace logs at Telegram entrypoint (`tag:"nlu"`, text, final intent, extracted fields, reason) for production diagnostics.

## 2026-02-16 — Daily agenda delivery strategy

- Added protected endpoint `POST /cron/daily` using `CRON_SECRET` (query or header).
- Chose external scheduler trigger approach; no in-process timers on Render.
- Daily message is generated from DB appointments ordered by time.
