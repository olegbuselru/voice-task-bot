#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://voice-task-bot-backend.onrender.com}"
CRON_SECRET="${CRON_SECRET:-REPLACE_CRON_SECRET}"

paths=("/" "/health")

for p in "${paths[@]}"; do
  code=$(curl -s -o /tmp/prod_verify_resp.json -w "%{http_code}" "${BASE_URL}${p}")
  echo "${p} ${code}"
done

echo "\n--- GET / headers ---"
curl -sS -i "${BASE_URL}/" | sed -n '1,20p'

echo "\n--- /health ---"
curl -sS "${BASE_URL}/health"
echo

echo "\n--- /cron/tick unauthorized check ---"
curl -s -o /tmp/prod_tick_unauth.json -w "%{http_code}\n" -X POST "${BASE_URL}/cron/tick"

echo "\n--- /cron/tick authorized check ---"
curl -sS -X POST "${BASE_URL}/cron/tick" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json"

echo "\n--- /cron/daily authorized check ---"
curl -sS -X POST "${BASE_URL}/cron/daily" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json"
echo
