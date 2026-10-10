# MarginGhost V0.4

MarginGhost investigates supplier invoices against a contract, purchase order, and optional amendments. It extracts PDF page text, asks the configured server-side provider to identify cited facts, verifies every excerpt against the uploaded page text, then runs the deterministic INR audit. It does not send supplier claims or change payments.

## Local workflow (Windows PowerShell)

```powershell
cd D:\marginghost
npm install
Copy-Item .env.example .env.local
# Keep LLM_MODE=offline for no-network mode. For live extraction in local development only,
# set LLM_MODE=groq_free and LLM_API_KEY in .env.local. Never use a NEXT_PUBLIC key.
npm run dev
```

Open http://localhost:3000. Add one contract, one purchase order, at least one invoice, and any relevant amendments. MarginGhost supports up to 25 documents total and PDFs up to 10 MB each. Enter the printed document ID shown inside each PDF; uploaded filenames are not used as document identities or financial facts. Choose **Investigate documents** to submit each file to `POST /api/ingest/pdf` in a multipart `file` field, then submit the returned page numbers and extracted text to `POST /api/investigate`.

Live Groq calls are restricted by the server to local development requests. In offline mode the API returns `needs_review` because no extractor is configured. Production deployments cannot make live investigations and the UI reports the server's restriction clearly. Scanned PDFs have no OCR support and may need text recognition before upload. Requests do not retry automatically. Choose Retry only after correcting the cause or when you want to submit again.

The **Local synthetic demonstration** buttons load the PDF fixtures in `fixtures/live-demo`. They do not display fixture audit results or claim a model ran. Submit the loaded files to make a real API request; a working local extractor configuration is required for a completed case. Three scenarios cover a potential overcharge, an amendment/PO disagreement, and a revised PO with no potential overcharge.

The result distinguishes `completed` from `needs_review`. A completed case with zero findings is reported as no potential overcharge found. A review case is never presented as an approved zero result. Evidence excerpts shown in the browser are returned by the API and come from exact uploaded page text.

## Checks (run from Windows PowerShell)

```powershell
npm run test
npm run typecheck
npm run lint
npm run build
```

## Privacy and limits

PDFs and extracted page text are held in the active browser session and are not written to local storage. They are sent to this application's API when investigating. Provider credentials stay server-side. Custom Neatlogs spans do not capture request or response content. The app has no authentication or persistent case storage. Keep synthetic/demo data separate from real supplier data when sharing screenshots.

One supplier, single currency (INR), and one purchase order per case are supported. Tax/freight allocation, OCR, historical invoice deduplication across separate cases, authentication, case persistence, and supplier communications are outside this milestone. Potential amounts are review leads, not approved claims.

## Existing observability setup

Neatlogs and Entire integrations are retained as configured. Existing Neatlogs diagnostics remain available:

```powershell
npm exec --offline --no -- neatlogs doctor --local --json
npm exec --offline --no -- neatlogs doctor --probe --json
```

`--probe` requires `NEATLOGS_API_KEY` in the shell. Entire checkpoints depend on supported coding-agent sessions and Git commits; verify with `entire checkpoint list` when using that workflow.
