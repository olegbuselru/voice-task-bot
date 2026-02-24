#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://voice-task-bot-backend.onrender.com}"
CRON_SECRET="${CRON_SECRET:-CRON_SECRET_VALUE}"

echo "--- /health ---"
curl -sS -i "${BASE_URL}/health" | sed -n '1,20p'

echo
echo "--- /cron/tick without auth (expect 401) ---"
curl -sS -i -X POST "${BASE_URL}/cron/tick" | sed -n '1,20p'

echo
echo "--- /cron/tick with auth (expect 200 when configured) ---"
curl -sS -i -X POST "${BASE_URL}/cron/tick" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" | sed -n '1,30p'

echo
echo "--- Local delivery test path ---"
cat <<'EOF'
1) In Telegram send: напомни сегодня в 21:30 тест
2) Trigger owner command /tick (OWNER_CHAT_ID only) OR call /cron/tick with auth
3) Verify bot sends: 🔔 Напоминание: тест
EOF
echo
