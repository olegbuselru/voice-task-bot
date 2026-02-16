#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://voice-task-bot-backend.onrender.com}"

paths=("/" "/health" "/tasks" "/clients" "/appointments" "/settings" "/availability")

for p in "${paths[@]}"; do
  code=$(curl -s -o /tmp/prod_verify_resp.json -w "%{http_code}" "${BASE_URL}${p}")
  echo "${p} ${code}"
done

echo "\n--- GET / headers ---"
curl -sS -i "${BASE_URL}/" | sed -n '1,20p'

echo "\n--- /appointments (head 400 bytes) ---"
curl -sS "${BASE_URL}/appointments" | head -c 400
echo

echo "\n--- /settings (head 400 bytes) ---"
curl -sS "${BASE_URL}/settings" | head -c 400
echo
