import assert from "node:assert/strict";
import test from "node:test";
import { extractWithConfiguredProvider, investigate, GROQ_ENDPOINT, GROQ_MODEL } from "../src/lib/investigation";
import { POST as investigatePost } from "../src/app/api/investigate/route";

function fixture({ billed = 120, contractPrice = 100, amendment = false, conflicting = false } = {}) {
  const docs = [
    { id: "C1", type: "contract", pages: [{ page: 1, text: `Contract C1 Supplier S1 INR valid 2025-01-01 SKU-X price ${contractPrice}` }] },
    ...(amendment ? [{ id: "A1", type: "amendment", pages: [{ page: 1, text: "Amendment A1 Supplier S1 contract C1 INR effective 2025-06-01 SKU-X price 110" }] }] : []),
    { id: "P1", type: "purchase_order", pages: [{ page: 1, text: `PO P1 Supplier S1 contract C1 INR 2025-07-01 SKU-X quantity 10 price ${amendment ? 110 : contractPrice}` }] },
    { id: "I1", type: "invoice", pages: [{ page: 1, text: `Invoice I1 Supplier S1 PO P1 INR 2025-07-02 SKU-X quantity 10 price ${billed}` }] }
  ];
  const cite = (value: unknown, d: (typeof docs)[number]) => ({ value, sourceId: d.id, page: 1, excerpt: d.pages[0].text });
  const contract = { type: "contract", id: cite("C1", docs[0]), supplierId: cite("S1", docs[0]), currency: cite("INR", docs[0]), validFrom: cite("2025-01-01", docs[0]), prices: [{ sku: cite("SKU-X", docs[0]), unitPrice: cite(contractPrice, docs[0]) }] };
  const pos = docs.find(d => d.type === "purchase_order")!;
  const inv = docs.find(d => d.type === "invoice")!;
  const po = { type: "purchase_order", id: cite("P1", pos), supplierId: cite("S1", pos), contractId: cite("C1", pos), currency: cite("INR", pos), orderedAt: cite("2025-07-01", pos), items: [{ sku: cite("SKU-X", pos), quantity: cite(10, pos), unitPrice: cite(amendment ? 110 : contractPrice, pos) }] };
  const invoice = { type: "invoice", id: cite("I1", inv), supplierId: cite("S1", inv), purchaseOrderId: cite("P1", inv), currency: cite("INR", inv), issuedAt: cite("2025-07-02", inv), items: [{ sku: cite("SKU-X", inv), quantity: cite(10, inv), unitPrice: cite(billed, inv) }] };
  const amendments = amendment ? [{ type: "amendment", id: cite("A1", docs[1]), supplierId: cite("S1", docs[1]), contractId: cite("C1", docs[1]), currency: cite("INR", docs[1]), effectiveFrom: cite("2025-06-01", docs[1]), prices: [{ sku: cite("SKU-X", docs[1]), unitPrice: cite(conflicting ? 115 : 110, docs[1]) }] }] : [];
  return { docs, facts: { documents: [contract, ...amendments, po, invoice] } };
}
const withFacts = (f: ReturnType<typeof fixture>, facts = f.facts) => investigate({ documents: f.docs }, async () => facts);

test("clean invoice completes with no recovery", async () => {
  const f = fixture({ billed: 100 }); const r = await withFacts(f);
  assert.equal(r.state, "completed"); assert.equal(r.case?.totalPotentialOvercharge, 0);
});
test("genuine overcharge yields deterministic recovery case", async () => {
  const f = fixture(); const r = await withFacts(f);
  assert.equal(r.state, "completed"); assert.equal(r.case?.totalPotentialOvercharge, 200);
  assert.ok(r.evidence.some(x => x.sourceId === "I1" && x.page === 1));
  assert.equal(r.selfAudit?.[0].disposition, "supported");
  assert.ok(r.selfAudit?.[0].checks.every(check => check.result === "passed"));
  assert.ok(r.selfAudit?.[0].supportingEvidence.some(x => x.sourceId === "I1"));
});
test("live investigation API returns supported, review, and rejected self-audit records", async () => {
  const savedEnv = { mode: process.env.LLM_MODE, url: process.env.LLM_API_URL, model: process.env.LLM_MODEL, key: process.env.LLM_API_KEY, demo: process.env.DEMO_MODE, node: process.env.NODE_ENV, logs: process.env.NEATLOGS_API_KEY };
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { LLM_MODE: "groq_free", LLM_API_URL: GROQ_ENDPOINT, LLM_MODEL: GROQ_MODEL, LLM_API_KEY: "test-key", DEMO_MODE: "false", NODE_ENV: "development" });
  delete process.env.NEATLOGS_API_KEY;
  try {
    const largeOvercharge = fixture({ billed: 525, contractPrice: 480 });
    const poDoc = largeOvercharge.docs.find(doc => doc.type === "purchase_order")!;
    const invoiceDoc = largeOvercharge.docs.find(doc => doc.type === "invoice")!;
    poDoc.pages[0].text = poDoc.pages[0].text.replace("quantity 10", "quantity 400");
    invoiceDoc.pages[0].text = invoiceDoc.pages[0].text.replace("quantity 10", "quantity 400");
    const poFact = largeOvercharge.facts.documents.find(document => document.type === "purchase_order") as { type: string; items: { quantity: { value: unknown } }[] } | undefined;
    const invoiceFact = largeOvercharge.facts.documents.find(document => document.type === "invoice") as { type: string; items: { quantity: { value: unknown }; unitPrice: { value: unknown } }[] } | undefined;
    if (!poFact || poFact.type !== "purchase_order" || !invoiceFact || invoiceFact.type !== "invoice") throw new Error("Expected purchase order and invoice");
    poFact.items[0].quantity.value = 400;
    invoiceFact.items[0].quantity.value = 400;
    invoiceFact.items[0].unitPrice.value = 525;
    const refreshExcerpts = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(refreshExcerpts);
      if (value && typeof value === "object") {
        const fact = value as Record<string, unknown>;
        if (typeof fact.sourceId === "string" && typeof fact.page === "number" && "excerpt" in fact) {
          const doc = largeOvercharge.docs.find(source => source.id === fact.sourceId);
          const page = doc?.pages.find(sourcePage => sourcePage.page === fact.page);
          if (page) fact.excerpt = page.text;
          return;
        }
        Object.values(fact).forEach(refreshExcerpts);
      }
    };
    refreshExcerpts(largeOvercharge.facts);
    for (const scenario of [
      { fixture: largeOvercharge, expected: "supported" },
      { fixture: fixture({ amendment: true, conflicting: true }), expected: "needs_review" },
      { fixture: fixture({ billed: 100 }), expected: "rejected" }
    ] as const) {
      let requests = 0;
      globalThis.fetch = (async () => {
        requests++;
        return Response.json({ choices: [{ message: { content: JSON.stringify(scenario.fixture.facts) } }] });
      }) as typeof fetch;
      const response = await investigatePost(new Request("http://localhost:3000/api/investigate", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ documents: scenario.fixture.docs }) }));
      const result = await response.json();
      assert.equal(response.status, 200);
      assert.equal(requests, 1);
      assert.equal(result.selfAudit[0].disposition, scenario.expected);
      assert.ok(Array.isArray(result.selfAudit[0].checks));
      assert.equal(typeof result.selfAudit[0].explanation, "string");
      if (scenario.expected === "supported") {
        assert.equal(result.case.totalPotentialOvercharge, 18000);
        assert.equal(result.selfAudit[0].disposition, "supported");
        assert.match(result.selfAudit[0].supportingEvidence.map((ref: { excerpt: string }) => ref.excerpt).join(" "), /price 480/);
        assert.match(result.selfAudit[0].supportingEvidence.map((ref: { excerpt: string }) => ref.excerpt).join(" "), /price 525/);
      }
      if (scenario.expected === "needs_review") assert.equal(result.selfAudit[0].checks.some((check: { result: string }) => check.result === "failed" || check.result === "not_verified"), true);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({ LLM_MODE: savedEnv.mode, LLM_API_URL: savedEnv.url, LLM_MODEL: savedEnv.model, LLM_API_KEY: savedEnv.key, DEMO_MODE: savedEnv.demo, NODE_ENV: savedEnv.node, NEATLOGS_API_KEY: savedEnv.logs })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
test("valid newer amendment supersedes old price", async () => {
  const f = fixture({ amendment: true, billed: 110 }); const r = await withFacts(f);
  assert.equal(r.state, "completed"); assert.equal(r.case?.totalPotentialOvercharge, 0);
});
test("conflicting amendment and PO pricing require review", async () => {
  const f = fixture({ amendment: true, conflicting: true, billed: 120 }); const r = await withFacts(f);
  assert.equal(r.state, "needs_review");
  assert.ok(r.selfAudit?.some(a => a.disposition === "needs_review"));
  assert.ok(r.selfAudit?.[0].contradictoryEvidence.some(e => e.sourceId === "A1"));
});

test("supplier identity change is not promoted as an overcharge", async () => {
  const f = fixture(); const facts = structuredClone(f.facts);
  const invoice = facts.documents.find(d => d.type === "invoice");
  if (!invoice || invoice.type !== "invoice") throw new Error("Expected invoice");
  invoice.supplierId.value = "S2";
  invoice.supplierId.excerpt = "Supplier S1";
  assert.equal((await withFacts(f, facts)).state, "needs_review");
});

test("contract effective date mismatch produces review, not a supported claim", async () => {
  const f = fixture(); const facts = structuredClone(f.facts);
  const contract = facts.documents[0] as { type: string; validFrom: { value: unknown } };
  contract.validFrom.value = "2025-08-01";
  assert.equal((await withFacts(f, facts)).state, "needs_review");
});
test("unsupported quotes and invalid model response are rejected", async () => {
  const f = fixture();

  const bad = structuredClone(f.facts);

  const contract = bad.documents[0];

  if (!("prices" in contract)) {
    throw new Error("Expected contract with prices");
  }

  contract.prices[0].unitPrice.excerpt = "fabricated";
  

  assert.equal(
    (await withFacts(f, bad)).state,
    "needs_review"
  );

  assert.equal(
    (
      await investigate(
        { documents: f.docs },
        async () => ({ nonsense: true })
      )
    ).state,
    "needs_review"
  );
});

test("offline mode makes zero network requests", async () => {
  const originalMode = process.env.LLM_MODE;
  const originalFetch = globalThis.fetch;
  let requests = 0;
  process.env.LLM_MODE = "offline";
  globalThis.fetch = (async () => { requests++; throw new Error("unexpected network request"); }) as typeof fetch;
  try {
    const f = fixture();
    assert.equal((await investigate({ documents: f.docs })).state, "needs_review");
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.LLM_MODE; else process.env.LLM_MODE = originalMode;
  }
});

test("live provider rejects endpoint overrides without making a request", async () => {
  const saved = { mode: process.env.LLM_MODE, url: process.env.LLM_API_URL, model: process.env.LLM_MODEL, key: process.env.LLM_API_KEY };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  Object.assign(process.env, { LLM_MODE: "groq_free", LLM_API_URL: "https://api.openai.com/v1/chat/completions", LLM_MODEL: GROQ_MODEL, LLM_API_KEY: "test-key" });
  globalThis.fetch = (async () => { requests++; throw new Error("unexpected request"); }) as typeof fetch;
  try {
    await assert.rejects(extractWithConfiguredProvider(fixture().docs as Parameters<typeof extractWithConfiguredProvider>[0]));
    assert.equal(requests, 0);
    process.env.LLM_API_URL = GROQ_ENDPOINT;
    process.env.LLM_MODEL = "gpt-4o-mini";
    await assert.rejects(extractWithConfiguredProvider(fixture().docs as Parameters<typeof extractWithConfiguredProvider>[0]));
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({ LLM_MODE: saved.mode, LLM_API_URL: saved.url, LLM_MODEL: saved.model, LLM_API_KEY: saved.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("HTTP 429 fails safely with needs_review and no retry", async () => {
  const saved = { mode: process.env.LLM_MODE, url: process.env.LLM_API_URL, model: process.env.LLM_MODEL, key: process.env.LLM_API_KEY };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  Object.assign(process.env, { LLM_MODE: "groq_free", LLM_API_URL: GROQ_ENDPOINT, LLM_MODEL: GROQ_MODEL, LLM_API_KEY: "test-key" });
  globalThis.fetch = (async () => { requests++; return new Response("quota detail with secret-ish content", { status: 429 }); }) as typeof fetch;
  try {
    const f = fixture();
    const result = await investigate({ documents: f.docs });
    assert.equal(result.state, "needs_review");
    assert.equal(requests, 1);
    assert.deepEqual(result.warnings, ["Extraction failed; manual review is required"]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({ LLM_MODE: saved.mode, LLM_API_URL: saved.url, LLM_MODEL: saved.model, LLM_API_KEY: saved.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("Groq request uses compatible completion token and strict cited-facts schema", async () => {
  const saved = { mode: process.env.LLM_MODE, url: process.env.LLM_API_URL, model: process.env.LLM_MODEL, key: process.env.LLM_API_KEY };
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let sent: unknown;
  Object.assign(process.env, { LLM_MODE: "groq_free", LLM_API_URL: GROQ_ENDPOINT, LLM_MODEL: GROQ_MODEL, LLM_API_KEY: "test-key" });
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    sent = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: "{}" } }] });
  }) as typeof fetch;
  try {
    await extractWithConfiguredProvider(fixture().docs as Parameters<typeof extractWithConfiguredProvider>[0]);
    type SentRequest = {
      model: string;
      max_completion_tokens: number;
      reasoning_effort: string;
      response_format: {
        type: string;
        json_schema: {
          name: string;
          strict: boolean;
          schema: { properties: { documents: { items: { type: string; properties: Record<string, unknown> } } } };
        };
      };
    };
    const request = sent as SentRequest;
    assert.equal(requestUrl, GROQ_ENDPOINT);
    assert.equal(request.model, GROQ_MODEL);
    assert.equal(request.max_completion_tokens, 1800);
    assert.equal(request.reasoning_effort, "low");
    assert.equal("max_tokens" in (sent as object), false);
    assert.equal(request.response_format.type, "json_schema");
    assert.equal(request.response_format.json_schema.name, "margin_ghost_facts");
    assert.equal(request.response_format.json_schema.strict, true);
    assert.equal(request.response_format.json_schema.schema.properties.documents.items.type, "object");
    const walkSchema = (schema: unknown): void => {
      if (Array.isArray(schema)) { schema.forEach(walkSchema); return; }
      if (!schema || typeof schema !== "object") return;
      const object = schema as Record<string, unknown>;
      assert.equal("anyOf" in object, false);
      if (object.type === "object") {
        assert.equal(object.additionalProperties, false);
        assert.ok(object.properties && typeof object.properties === "object");
        assert.deepEqual(object.required, Object.keys(object.properties as Record<string, unknown>));
      }
      Object.values(object).forEach(walkSchema);
    };
    walkSchema(request.response_format.json_schema.schema);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({ LLM_MODE: saved.mode, LLM_API_URL: saved.url, LLM_MODEL: saved.model, LLM_API_KEY: saved.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("Groq HTTP 400 diagnostics expose only allowlisted error identifiers", async () => {
  const saved = { mode: process.env.LLM_MODE, url: process.env.LLM_API_URL, model: process.env.LLM_MODEL, key: process.env.LLM_API_KEY };
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { LLM_MODE: "groq_free", LLM_API_URL: GROQ_ENDPOINT, LLM_MODEL: GROQ_MODEL, LLM_API_KEY: "test-key" });
  globalThis.fetch = (async () => Response.json({ error: { code: "invalid_json_schema", type: "invalid_request_error", param: "response_format.json_schema.schema", message: "Rejected anyOf schema. secret and document contents must not escape" } }, { status: 400 })) as typeof fetch;
  try {
    const result = await investigate({ documents: fixture().docs });
    assert.deepEqual(result.diagnostic, { category: "groq_http", status: 400, providerCode: "invalid_json_schema", providerType: "invalid_request_error", param: "response_format.json_schema.schema", providerKeyword: "anyof" });
    assert.equal(JSON.stringify(result.diagnostic).includes("secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({ LLM_MODE: saved.mode, LLM_API_URL: saved.url, LLM_MODEL: saved.model, LLM_API_KEY: saved.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("invalid model JSON and provider schema failures expose only safe diagnostics", async () => {
  const saved = { mode: process.env.LLM_MODE, url: process.env.LLM_API_URL, model: process.env.LLM_MODEL, key: process.env.LLM_API_KEY };
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { LLM_MODE: "groq_free", LLM_API_URL: GROQ_ENDPOINT, LLM_MODEL: GROQ_MODEL, LLM_API_KEY: "test-key" });
  try {
    const f = fixture();
    globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: "not-json containing private data" } }] })) as typeof fetch;
    const invalidJson = await investigate({ documents: f.docs });
    assert.deepEqual(invalidJson.diagnostic, { category: "invalid_json" });
    globalThis.fetch = (async () => Response.json({ private_secret: "never report this" })) as typeof fetch;
    const invalidShape = await investigate({ documents: f.docs });
    assert.equal(invalidShape.diagnostic?.category, "schema_validation");
    assert.ok(invalidShape.diagnostic?.fields?.length);
    assert.equal(JSON.stringify(invalidShape.diagnostic).includes("private_secret"), false);
    assert.equal(JSON.stringify(invalidShape.diagnostic).includes("never report this"), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({ LLM_MODE: saved.mode, LLM_API_URL: saved.url, LLM_MODEL: saved.model, LLM_API_KEY: saved.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("evidence mismatch returns a sanitized diagnostic field path", async () => {
  const f = fixture();
  const bad = structuredClone(f.facts);
  const contract = bad.documents[0];
  if (!("prices" in contract)) throw new Error("Expected contract prices");
  contract.prices[0].unitPrice.excerpt = "not evidence";
  const result = await withFacts(f, bad);
  assert.equal(result.diagnostic?.category, "missing_evidence");
  assert.deepEqual(result.diagnostic?.fields, ["documents[0].prices[0].unitPrice"]);
});

test("Groq document type aliases reconcile only to supplied source types", async () => {
  const saved = { mode: process.env.LLM_MODE, url: process.env.LLM_API_URL, model: process.env.LLM_MODEL, key: process.env.LLM_API_KEY };
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { LLM_MODE: "groq_free", LLM_API_URL: GROQ_ENDPOINT, LLM_MODEL: GROQ_MODEL, LLM_API_KEY: "test-key" });
  try {
    const f = fixture({ billed: 100 });
    const aliasFacts = structuredClone(f.facts);
    aliasFacts.documents[0].type = "Contract";
    aliasFacts.documents[1].type = "Purchase Order";
    aliasFacts.documents[2].type = "Invoice";
    globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: JSON.stringify(aliasFacts) } }] })) as typeof fetch;
    const result = await investigate({ documents: f.docs });
    assert.equal(result.state, "completed");
    assert.equal(result.case?.totalPotentialOvercharge, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({ LLM_MODE: saved.mode, LLM_API_URL: saved.url, LLM_MODEL: saved.model, LLM_API_KEY: saved.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("model output cannot change a supplied document identity", async () => {
  const f = fixture({ billed: 100 });
  const changedIdentity = structuredClone(f.facts);
  changedIdentity.documents[2].id.value = "OTHER-INVOICE";
  const result = await withFacts(f, changedIdentity);
  assert.equal(result.state, "needs_review");
  assert.equal(result.diagnostic?.category, "unsupported_evidence");
  assert.deepEqual(result.diagnostic?.fields, ["documents[2].id"]);
});

test("incomplete citation objects fail schema validation without filling facts", async () => {
  const f = fixture({ billed: 100 });
  const incomplete = structuredClone(f.facts);
  delete (incomplete.documents[0].supplierId as { excerpt?: string }).excerpt;
  const result = await withFacts(f, incomplete);
  assert.equal(result.state, "needs_review");
  assert.equal(result.diagnostic?.category, "schema_validation");
  assert.ok(result.diagnostic?.fields?.includes("documents[0].supplierId.excerpt"));
});

test("malformed field structures fail schema validation", async () => {
  const f = fixture({ billed: 100 });
  const malformed = structuredClone(f.facts);
  const contract = malformed.documents[0] as { prices: { unitPrice: unknown }[] };
  contract.prices[0].unitPrice = 100;
  const result = await withFacts(f, malformed);
  assert.equal(result.state, "needs_review");
  assert.equal(result.diagnostic?.category, "schema_validation");
  assert.ok(result.diagnostic?.fields?.includes("documents[0].prices[0].unitPrice"));
});

test("complete cited contract, purchase order, and invoice facts validate", async () => {
  const f = fixture({ billed: 100 });
  const result = await withFacts(f);
  assert.equal(result.state, "completed");
  assert.equal(result.case?.totalPotentialOvercharge, 0);
  assert.equal(result.evidence.length, 22);
});

test("PO contractId remains a complete citation to the exact PO reference", async () => {
  const f = fixture({ billed: 100 });
  const result = await withFacts(f);
  const po = f.facts.documents[1] as { type: string; contractId: unknown };
  if (po.type !== "purchase_order") throw new Error("Expected purchase order");
  assert.deepEqual(po.contractId, { value: "C1", sourceId: "P1", page: 1, excerpt: f.docs[1].pages[0].text });
  assert.equal(result.state, "completed");
  assert.ok(result.evidence.some(e => e.field === "documents[1].contractId" && e.sourceId === "P1" && e.excerpt.includes("contract C1")));
});

test("missing or malformed PO contract references fail closed with safe structural diagnostics", async () => {
  const f = fixture({ billed: 100 });
  const missing = structuredClone(f.facts);
  const missingPo = missing.documents.find(document => document.type === "purchase_order");
  if (!missingPo || missingPo.type !== "purchase_order") throw new Error("Expected purchase order");
  delete (missingPo as { contractId?: unknown }).contractId;
  const missingResult = await withFacts(f, missing);
  assert.equal(missingResult.state, "needs_review");
  assert.deepEqual(missingResult.diagnostic?.structuralFailures, [{ field: "documents[1].contractId", reason: "missing" }]);

  const malformed = structuredClone(f.facts);
  const malformedPo = malformed.documents.find(document => document.type === "purchase_order");
  if (!malformedPo || malformedPo.type !== "purchase_order") throw new Error("Expected purchase order");
  (malformedPo as { contractId: unknown }).contractId = "C1";
  const malformedResult = await withFacts(f, malformed);
  assert.equal(malformedResult.state, "needs_review");
  assert.deepEqual(malformedResult.diagnostic?.structuralFailures, [{ field: "documents[1].contractId", reason: "wrong_type" }]);
  assert.equal(JSON.stringify(malformedResult.diagnostic).includes("C1"), false);

  const nullReference = structuredClone(f.facts);
  const nullPo = nullReference.documents.find(document => document.type === "purchase_order");
  if (!nullPo || nullPo.type !== "purchase_order") throw new Error("Expected purchase order");
  (nullPo as { contractId: unknown }).contractId = null;
  const nullResult = await withFacts(f, nullReference);
  assert.deepEqual(nullResult.diagnostic?.structuralFailures, [{ field: "documents[1].contractId", reason: "null" }]);
});
