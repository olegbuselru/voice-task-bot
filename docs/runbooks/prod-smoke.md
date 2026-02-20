# Production smoke checks (Telegram-only backend)

Base URL example:

```bash
export BASE_URL="https://voice-task-bot-backend.onrender.com"
export CRON_SECRET="REPLACE_CRON_SECRET"
```

## 1) Health

```bash
curl -i "$BASE_URL/health"
```

Expected: `200` and `{"status":"ok"}`.

## 2) Webhook basic check

```bash
curl -i -X POST "$BASE_URL/telegram/webhook" \
  -H 'Content-Type: application/json' \
  -d '{"update_id":1}'
```

Expected: `400` (`invalid telegram update`) for malformed payload, or `200` for valid Telegram update.

## 3) Cron auth check

```bash
curl -i -X POST "$BASE_URL/cron/tick"
curl -i -X POST "$BASE_URL/cron/daily"
```

Expected: both `401` without token.

## 4) Cron execution check

```bash
curl -i -X POST "$BASE_URL/cron/tick" \
  -H "Authorization: Bearer $CRON_SECRET"

curl -i -X POST "$BASE_URL/cron/daily" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected: `200` JSON with `ok: true`.

## 5) End-to-end Telegram manual checklist

1. Send `/start`.
2. Send: `Сделать отчет завтра 10:00, напоминай каждые 3 часа`.
3. Send `/today` and verify task line + buttons.
4. Wait or trigger `/cron/tick` and verify reminder has buttons `✅/❌/📥`.
5. Tap `📥 Отложить в коробку` and verify reminders stop for this task.
6. Tap `✅ Выполнено` and verify idempotent second tap behavior (`Уже выполнено`).
7. Trigger `/cron/daily` and verify digest at 09:00 MSK format.
