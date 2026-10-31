# Suara Lapangan suite

`tests/suara-lapangan.e2e.ts` drives the Suara Lapangan app, not this example's
greeter. It needs that app running and real credentials, so it is left out of
`e2e.config.ts` and runs from `e2e.suara.config.ts`.

## Prerequisites

- The repository's packages built — the suite imports the built ones, not the
  published ones: `pnpm install && pnpm run build`.
- `psql` on `PATH`: the suite creates the session its document test needs.
- The app built and running:

  ```bash
  cd /home/ubuntu/repos/suara-lapangan
  npm ci && npm run build
  npm run start -- --port 3021
  ```

## Environment

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | The app's Postgres turns store. The suite writes one session there and removes it again. |
| `MODEL_API_KEY` | Meta model key. Without it `POST /api/documents` takes the rule fallback and the model-path test fails. |
| `SUARA_APP_URL` | The app's origin. Defaults to `http://localhost:3000`. |

Both secrets come from Akeyless: `/workstation/credential/terravoce-db` (field
`url`) and `/workstation/credential/muse` (field `api_key`). Export them into the
environment; never pass them on a command line.

## Run

```bash
cd examples/with-next
SUARA_APP_URL=http://localhost:3021 npx e2e run --config e2e.suara.config.ts tests/suara-lapangan.e2e.ts
```

Run output lands in `.e2e/`, which is git-ignored.
