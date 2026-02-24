# Cron setup (external scheduler)

Use an external scheduler to call `POST /cron/tick` every minute.

- URL: `https://<backend-url>/cron/tick`
- Method: `POST`
- Header: `Authorization: Bearer <CRON_SECRET_VALUE>`

Manual curl check:

```bash
curl -X POST "https://<backend-url>/cron/tick" \
  -H "Authorization: Bearer <CRON_SECRET_VALUE>"
```

## Setup steps (3–5 steps)

1. Set `CRON_SECRET` env in Render backend service.
2. Confirm endpoint auth works:
   - no header -> `401`
   - with header -> `200`
3. Create external cron job with 1-minute schedule.
4. Configure request as `POST` with `Authorization: Bearer <CRON_SECRET_VALUE>`.
5. Verify backend logs contain `cron_tick_start` and `cron_tick_done`.

## Option A: cron-job.org

- URL: `https://<backend-url>/cron/tick`
- Method: `POST`
- Schedule: every minute
- Header: `Authorization: Bearer <CRON_SECRET_VALUE>`

## Option B: GitHub Actions

```yaml
name: backend-cron-tick
on:
  schedule:
    - cron: '* * * * *'
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - name: Call cron tick
        run: |
          curl -sS -X POST "$BASE_URL/cron/tick" \
            -H "Authorization: Bearer $CRON_SECRET"
```

Set repository secrets: `BASE_URL`, `CRON_SECRET`.
