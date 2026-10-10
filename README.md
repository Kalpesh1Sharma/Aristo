# MarginGhost V0.1 — neatHack starter

This starter is an **evidence-first deterministic baseline**, not yet an autonomous LLM agent. It accepts structured JSON contract/PO/invoice records, calculates potential supplier overcharges with auditable rules, and emits optional Neatlogs workflow/tool spans. No PDF extraction or supplier email sending is included in V0.1.

## Windows PowerShell setup

```powershell
cd D:\
# Extract marginghost-starter.zip to D:\marginghost
cd D:\marginghost
npm install
Copy-Item .env.example .env.local
# Put NEATLOGS_API_KEY in .env.local from your dashboard
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

1. Add PDF text extraction with verified source-page references; never let the LLM invent citation offsets.
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
