# MarginGhost V0.4

MarginGhost demonstrates evidence-led comparison of supplier invoices with a contract, purchase order, and amendments. It does not approve claims, contact suppliers, or change payments.

## Public hackathon demo

Public production deployments run in **synthetic-only demo mode by default**. The page replays three bundled, invented examples with their PDF page excerpts and deterministic financial outcomes. These are fixed demonstrations, not live AI investigations. No PDFs are uploaded in the public demo, no inference provider is called, and no paid API is used.

| Scenario | Source facts | Demonstration outcome |
| --- | --- | --- |
| Potential overcharge | Contract and PO: ₹480/unit; invoice: ₹525 × 400 | ₹18,000 potential discrepancy; human review required |
| Amendment conflict | Amendment: ₹525/unit; unchanged PO: ₹480/unit; invoice: ₹525 | Manual review; no claim amount is asserted |
| Revised PO | Amendment and revised PO: ₹525/unit; invoice: ₹525 × 400 | ₹0 potential discrepancy |

The synthetic fixture names, suppliers, dates, IDs, and values are invented. Demo mode returns HTTP 403 for direct requests to both `POST /api/investigate` and `POST /api/ingest/pdf`; the restriction is enforced on the server even if a caller bypasses the page. The deterministic audit and evidence-verification code remain available for explicitly configured local development.

### Deploy from GitHub to Vercel

1. Push this project to a GitHub repository using your normal Git workflow. Do not add `.env` or `.env.local`; they contain local configuration and are not needed by a public demo.
2. Sign in to [Vercel](https://vercel.com/) and choose **Add New → Project**.
3. Import the GitHub repository and authorize Vercel to access it.
4. Keep the detected Next.js framework preset and default build settings. Vercel uses `npm install` and `npm run build`; no custom output directory or deployment adapter is needed.
5. In **Environment Variables**, add `DEMO_MODE` with value `true` for **Production**, **Preview**, and **Development** environments. Production already defaults to demo mode if this variable is omitted; setting it explicitly also protects preview deployments.
6. Leave `LLM_API_KEY`, `NEATLOGS_API_KEY`, and all other secret fields unset. They are unnecessary for this demo.
7. Choose **Deploy**. Vercel builds the Next.js app and assigns a public URL. Subsequent GitHub pushes to the connected branch trigger Vercel deployments automatically.
8. Open the Vercel URL, replay all three scenarios, and confirm the amendment conflict displays **Manual review needed**. For an endpoint check, send POST requests to `/api/investigate` and `/api/ingest/pdf`; each must return HTTP 403 with a demo-mode-disabled message.

To keep a deployment synthetic-only even if its runtime environment changes, retain `DEMO_MODE=true`. Setting `DEMO_MODE=false` opts out of the explicit demo flag, but live inference still requires local development and requests from localhost; a public Vercel host cannot use Groq through this app.

## Local development

```powershell
cd D:\marginghost
npm install
Copy-Item .env.example .env.local
# DEMO_MODE=false and LLM_MODE=offline provide local no-network behavior.
npm run dev
```

Open http://localhost:3000. With `DEMO_MODE=false`, the document workflow remains available. Offline mode performs no provider request and produces `needs_review` because no extractor is configured. To explicitly enable local Groq extraction, set `LLM_MODE=groq_free` and `LLM_API_KEY` in `.env.local`; requests are limited to localhost in development, provider/model/endpoint are allowlisted, and there is no paid fallback. Never put a provider key in a `NEXT_PUBLIC_*` variable or in a public deployment.

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

Public demo mode does not ingest supplied PDFs or call any AI provider. In local document mode, PDFs and extracted text remain in the active browser session until submitted to the local app API; there is no authentication or persistent case storage. One supplier, one currency (INR), and one purchase order per case are supported. Tax/freight allocation, OCR, cross-case invoice deduplication, authentication, case persistence, and supplier communications are outside this milestone.
