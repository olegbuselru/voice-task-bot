# Cron setup (external scheduler)

Required endpoint security:

- `POST /cron/tick`
- `POST /cron/daily`
- Header: `Authorization: Bearer <CRON_SECRET>`

Timezone target: `Europe/Moscow`.

## Option A: cron-job.org (quick)

1. Create job `tick`:
   - URL: `https://voice-task-bot-backend.onrender.com/cron/tick`
   - Method: `POST`
   - Every minute
   - Header: `Authorization: Bearer CRON_SECRET`
2. Create job `daily`:
   - URL: `https://voice-task-bot-backend.onrender.com/cron/daily`
   - Method: `POST`
   - Schedule: `09:00` Europe/Moscow
   - Header: `Authorization: Bearer CRON_SECRET`

## Option B: GitHub Actions schedule

Create workflow with two schedules:

```yaml
name: backend-cron
on:
  schedule:
    - cron: '* * * * *' # tick every minute
    - cron: '0 6 * * *' # 09:00 MSK (UTC+3)
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - name: Tick
        if: github.event.schedule == '* * * * *'
        run: |
          curl -sS -X POST "$BASE_URL/cron/tick" \
            -H "Authorization: Bearer $CRON_SECRET"
      - name: Daily digest
        if: github.event.schedule == '0 6 * * *'
        run: |
          curl -sS -X POST "$BASE_URL/cron/daily" \
            -H "Authorization: Bearer $CRON_SECRET"
```

Set repository secrets: `BASE_URL`, `CRON_SECRET`.

## Option C: Render Cron (optional)

If available in Render plan, configure two cron jobs with same URLs and headers.
