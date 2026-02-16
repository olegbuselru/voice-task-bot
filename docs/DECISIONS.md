# DECISIONS

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
- This prevents LLM hallucinations in availability calculations.

## 2026-02-16 — Telegram action UX

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
