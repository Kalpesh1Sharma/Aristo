# MarginGhost V0.4

MarginGhost demonstrates evidence-led comparison of supplier invoices with a contract, purchase order, and amendments. It does not approve claims, contact suppliers, or change payments.

## Public hackathon demo

Public production deployments run in **synthetic-only demo mode by default**. The page replays three bundled, invented examples with their PDF page excerpts and deterministic financial outcomes. These are fixed demonstrations, not live AI investigations. No PDFs are uploaded in the public demo, no inference provider is called, and no paid API is used.

| Scenario | Source facts | Demonstration outcome |
| --- | --- | --- |
| Potential overcharge | Contract and PO: ₹480/unit; invoice: ₹525 × 400 | ₹18,000 potential discrepancy; human review required |
| Amendment conflict | Amendment: ₹525/unit; unchanged PO: ₹480/unit; invoice: ₹525 | Manual review; no claim amount is asserted |
| Revised PO | Amendment and revised PO: ₹525/unit; invoice: ₹525 × 400 | ₹0 potential discrepancy |

The synthetic fixture names, suppliers, dates, IDs, and values are invented. Production processing stays HTTP 403 by default, including direct requests to every processing API. The deterministic audit and evidence-verification code remain available for explicitly configured local development.

### Deploy from GitHub to Vercel

1. Push this project to a GitHub repository using your normal Git workflow. Do not add `.env` or `.env.local`; they contain local configuration and are not needed by a public demo.
2. Sign in to [Vercel](https://vercel.com/) and choose **Add New → Project**.
3. Import the GitHub repository and authorize Vercel to access it.
4. Keep the detected Next.js framework preset and default build settings. Vercel uses `npm install` and `npm run build`; no custom output directory or deployment adapter is needed.
5. In **Environment Variables**, set `DEMO_MODE=true` and `JUDGE_PREVIEW_ENABLED=false` for **Production**, **Preview**, and **Development** environments.
6. Leave `LLM_API_KEY`, `NEATLOGS_API_KEY`, and all other secret fields unset. They are unnecessary for the public demo.
7. Choose **Deploy**. Vercel builds the Next.js app and assigns a public URL. Subsequent GitHub pushes to the connected branch trigger Vercel deployments automatically.
8. Open the Vercel URL, replay all three scenarios, and confirm the amendment conflict displays **Manual review needed**. POST requests to all processing endpoints must return HTTP 403.

To keep a deployment synthetic-only, retain `DEMO_MODE=true` and `JUDGE_PREVIEW_ENABLED=false`.

## Invite-only judge preview (disabled by default)

The preview supports server-side PDF extraction and Groq investigation for invited judges. It is a hackathon demonstration, not a production financial-data service. Judges must not upload confidential, personal, or real customer financial information. Use synthetic or explicitly approved documents only. Files and extracted content are processed in memory for the request; the app does not save them to a database or intentionally send them to neatlogs. Tracing spans disable input/output capture. Groq receives extracted page text to perform document fact extraction; review Groq's current data handling terms before enabling any non-synthetic content.

**Keep `JUDGE_PREVIEW_ENABLED=false` until the deployment has been independently tested.** Production processing remains closed unless the flag is exactly `true`, `DEMO_MODE` is not enabled, all required configuration validates, and Redis is available. Authenticated processing requires a valid signed one-hour cookie and same-origin request. Password attempts, PDF uploads, deterministic audit calls, and Groq investigations have separate persistent limits. Uploading PDFs does not consume investigation credits; one call to `/api/investigate` reserves one credit before provider inference. Limits use atomic Redis Lua operations across serverless instances. Missing configuration, quota exhaustion, or Redis failure rejects access.

Per-client limiting uses Vercel's `x-vercel-forwarded-for` platform header and ignores ordinary forwarded-IP headers supplied by callers. If a reverse proxy sits in front of Vercel, verify the trusted-proxy arrangement before enabling the preview; requests without Vercel's trusted client-IP header are rejected for processing and login.

### Required Vercel environment variables

Use these first in a protected **Preview** deployment with test credentials and a separate Upstash database. Keep Production on `DEMO_MODE=true` and `JUDGE_PREVIEW_ENABLED=false` throughout deployment verification. Only consider setting the Production variables after all Preview checks pass and the protections have been independently reviewed.

| Variable | Value |
| --- | --- |
| `JUDGE_PREVIEW_ENABLED` | Keep `false` until verified; then set exactly `true` to open preview access. |
| `JUDGE_PREVIEW_PASSWORD_HASH` | Strong scrypt verifier generated with the command below; never store the plaintext password. |
| `JUDGE_PREVIEW_SESSION_SECRET` | At least 32 random characters, generated below. |
| `JUDGE_PREVIEW_DAILY_LIMIT` | Optional integer 1–1000; defaults to 30 global investigations per day. |
| `UPSTASH_REDIS_REST_URL` | HTTPS REST URL from the Upstash Redis database details page. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token. |
| `LLM_MODE` | Exactly `groq_free`. |
| `LLM_API_KEY` | Groq API key, stored only as a server environment variable. |
| `LLM_PAID_FALLBACK` | Exactly `false`. |
| `DEMO_MODE` | `false` while preview is deliberately enabled. |

`LLM_API_URL` and `LLM_MODEL`, if set, must remain `https://api.groq.com/openai/v1/chat/completions` and `openai/gpt-oss-20b` respectively. The server rejects other values. Do not add provider secrets to `NEXT_PUBLIC_*` variables. `NEATLOGS_API_KEY` is not needed for this preview; leave it unset.

### Provisioning and setting up Upstash

1. Create a Redis database in Upstash, select a region close to the Vercel deployment, and copy its **HTTPS REST URL** and **REST token**. Do not use the Redis TCP connection string. No key or database schema setup is required; the app creates expiring limiter keys under the `mg:limit:` prefix.
2. Generate a unique password of at least 20 characters and keep it in your approved password manager for invited judges. In the repository root, run `node scripts/create-judge-password-verifier.mjs` and enter it at the prompt. Paste only the printed scrypt verifier into Vercel as `JUDGE_PREVIEW_PASSWORD_HASH`; do not put the password in a shell command, source file, or deployment log.
3. Generate the session signing key locally with `openssl rand -base64 48`. Add it to Vercel as `JUDGE_PREVIEW_SESSION_SECRET`.
4. Add the test Redis URL/token and a restricted Groq key plus the other required variables in Vercel **Project → Settings → Environment Variables**, scoped to **Preview**. Set `DEMO_MODE=false` and `JUDGE_PREVIEW_ENABLED=true` only for that protected Preview environment, then deploy a Preview URL. Production remains synthetic-only and disabled.
5. Independently verify missing-config rejection, login throttling, cookie attributes/expiry, CSRF rejection, all three API routes, Redis failure and quota exhaustion, and public `/`, `/demo`, `/evaluation` behavior on the Preview deployment. If all checks pass, a separately authorized operator can configure Production with the required secrets and set `DEMO_MODE=false` and `JUDGE_PREVIEW_ENABLED=true`; this repository change itself does not enable live processing, and no Production variables are being changed here.

### Immediate shutdown

In Vercel **Project → Settings → Environment Variables**, set `JUDGE_PREVIEW_ENABLED=false` for Production and redeploy (or promote a deployment built with the flag false). This immediately makes sign-in and processing APIs reject requests once the changed environment is active. Also revoke the Groq key and Upstash REST token if you suspect exposure. Existing cookies stop authorizing requests when preview configuration is disabled.

## Local development

```powershell
cd D:\marginghost
npm install
Copy-Item .env.example .env.local
# DEMO_MODE=false and LLM_MODE=offline provide local no-network behavior.
npm run dev
```

Open http://localhost:3000. With `DEMO_MODE=false`, the document workflow remains available. Offline mode performs no provider request and produces `needs_review` because no extractor is configured. For local-only Groq testing, set `LLM_MODE=groq_free` and `LLM_API_KEY` in `.env.local`; provider/model/endpoint are allowlisted and there is no paid fallback. Never put a provider key in a `NEXT_PUBLIC_*` variable.

The local workflow accepts one contract, one purchase order, one or more invoices, and optional amendments, up to 25 PDFs total and 10 MB each. Enter each printed document ID shown inside its PDF. The server extracts selectable PDF text, verifies every cited excerpt against exact page text, and then runs the deterministic INR audit. Scanned PDFs have no OCR support. Potential amounts are review leads, not approved claims.

## Checks

```powershell
npm run test
npm run typecheck
npm run lint
npm run build
```

Tests cover deterministic audit behavior, cited evidence validation, all three synthetic fixture outcomes, and direct HTTP requests to demo-disabled endpoints.

### Deterministic adversarial evaluation

Open `/evaluation` for a read-only replay of fixed adversarial fixtures through the same evidence verification and deterministic decision pipeline used by investigations. The route executes local fixture extraction only: it does not accept user input, call a model provider, or use paid inference. Its pass/fail summary compares actual dispositions with scenario expectations; it is a deterministic regression check, not an LLM accuracy benchmark.

Run `npm run evaluate` to reproduce the scenarios and write `src/lib/evaluation-snapshot.json`. The generated JSON includes its generation time, the repository revision at generation, and each actual/expected outcome with test provenance. Rerun the command after changing fixtures or decision logic. The generated file is an artifact and is not consumed as live dashboard data.

## Privacy and limitations

Public demo mode does not ingest supplied PDFs or call any AI provider. In local document mode, PDFs and extracted text remain in the active browser session until submitted to the local app API; there is no persistent case storage. The invite-only judge preview is rate-limited but remains a hackathon demonstration, not a production financial-data service. One supplier, one currency (INR), and one purchase order per case are supported. Tax/freight allocation, OCR, cross-case invoice deduplication, case persistence, and supplier communications are outside this milestone.
