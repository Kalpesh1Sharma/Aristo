# MarginGhost V0.3 — evidence-backed supplier invoice investigation

MarginGhost accepts extracted PDF page text, asks a server-side OpenAI-compatible provider to extract cited facts, validates every quote against its exact source page, resolves applicable price amendments, and uses the deterministic TypeScript audit engine to calculate a potential recovery case. No supplier communication or payment is performed. The existing JSON audit and PDF ingestion routes remain available.

## Windows PowerShell setup

```powershell
cd D:\
# Extract marginghost-starter.zip to D:\marginghost
cd D:\marginghost
npm install
Copy-Item .env.example .env.local
# Configure LLM_API_KEY (and optionally NEATLOGS_API_KEY) in .env.local
npm run test
npm run typecheck
npm run dev
```

Open http://localhost:3000 and load `fixtures/audit.json`. Expected total: INR 18,000.

## Verify observability

```powershell
npm exec --offline --no -- neatlogs doctor --local --json
npm exec --offline --no -- neatlogs doctor --probe --json
```

The `--probe` step requires a valid `NEATLOGS_API_KEY` set in your shell environment. `init()` runs once per server process, and the route flushes before returning. Data capture is off on custom spans for privacy. To collect model spans in the next phase, wrap the actual AI provider client as documented at https://docs.neatlogs.com/sdk/typescript.

## PDF investigation

Send a multipart `POST` to `/api/ingest/pdf` with a `file` field containing a PDF (up to 10 MB and 250 pages). Assign the returned pages a document `id` and `type` (`contract`, `purchase_order`, `invoice`, or `amendment`) and submit `{ "documents": [...] }` to `/api/investigate`. The API returns a bounded state history and either a deterministic audit case or `needs_review`. Scanned PDFs have no OCR support. The model provider receives page text; Neatlogs custom spans capture neither inputs nor outputs. The extraction provider can be changed with `LLM_API_URL` and `LLM_MODEL`.

## Entire setup (do this before coding with an agent)

From PowerShell, review the official installer at https://github.com/entireio/cli and install:

```powershell
irm https://entire.io/install.ps1 | iex
entire --version
git init
entire enable
entire status
entire agent list
```

If your coding agent is not connected, run `entire agent add --help` and install its supported integration. Entire checkpoints depend on supported coding-agent sessions and Git commits; merely running `entire enable` is not evidence of checkpoints. Always verify with `entire checkpoint list`.

## Next milestones

1. Add reviewed PDF-to-record mapping with verified source-page references; never let the LLM invent citation offsets.
2. Add a real LLM decision loop for matching ambiguous descriptions and investigating amendments, with bounded retries and typed tools.
3. Add an amendment-aware contract resolver and a new regression test.
4. Add case draft/approval and persistent state.
5. Add a cfo.ai plan and its evidence to submission artifacts.

## Constraints

- One supplier, single currency (INR), one purchase order, no tax/freight allocation.
- JSON first, no OCR, no implicit parsing of attachments.
- No invoice lines with repeated SKUs; those require review.
- The current version does not check historical invoice duplication across separate requests.
- `checkedInvoices` counts unique same-supplier/same-PO invoice IDs, even if skipped because of uncertain line items.
- The recorded `evidence` field is supplied text, not a cryptographically validated document quote.
- Prototype only: no authentication, upload persistence or customer-ready data security.
