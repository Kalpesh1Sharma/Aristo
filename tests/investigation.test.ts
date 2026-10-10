import assert from "node:assert/strict";
import test from "node:test";
import { extractWithConfiguredProvider, investigate, GROQ_ENDPOINT, GROQ_MODEL } from "../src/lib/investigation";

function fixture({ billed = 120, amendment = false, conflicting = false } = {}) {
  const docs = [
    { id: "C1", type: "contract", pages: [{ page: 1, text: "Contract C1 Supplier S1 INR valid 2025-01-01 SKU-X price 100" }] },
    ...(amendment ? [{ id: "A1", type: "amendment", pages: [{ page: 1, text: "Amendment A1 Supplier S1 contract C1 INR effective 2025-06-01 SKU-X price 110" }] }] : []),
    { id: "P1", type: "purchase_order", pages: [{ page: 1, text: `PO P1 Supplier S1 contract C1 INR 2025-07-01 SKU-X quantity 10 price ${amendment ? 110 : 100}` }] },
    { id: "I1", type: "invoice", pages: [{ page: 1, text: `Invoice I1 Supplier S1 PO P1 INR 2025-07-02 SKU-X quantity 10 price ${billed}` }] }
  ];
  const cite = (value: unknown, d: (typeof docs)[number]) => ({ value, sourceId: d.id, page: 1, excerpt: d.pages[0].text });
  const contract = { type: "contract", id: cite("C1", docs[0]), supplierId: cite("S1", docs[0]), currency: cite("INR", docs[0]), validFrom: cite("2025-01-01", docs[0]), prices: [{ sku: cite("SKU-X", docs[0]), unitPrice: cite(100, docs[0]) }] };
  const pos = docs.find(d => d.type === "purchase_order")!;
  const inv = docs.find(d => d.type === "invoice")!;
  const po = { type: "purchase_order", id: cite("P1", pos), supplierId: cite("S1", pos), contractId: cite("C1", pos), currency: cite("INR", pos), orderedAt: cite("2025-07-01", pos), items: [{ sku: cite("SKU-X", pos), quantity: cite(10, pos), unitPrice: cite(amendment ? 110 : 100, pos) }] };
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
});
test("valid newer amendment supersedes old price", async () => {
  const f = fixture({ amendment: true, billed: 110 }); const r = await withFacts(f);
  assert.equal(r.state, "completed"); assert.equal(r.case?.totalPotentialOvercharge, 0);
});
test("conflicting amendment and PO pricing require review", async () => {
  const f = fixture({ amendment: true, conflicting: true, billed: 120 }); const r = await withFacts(f);
  assert.equal(r.state, "needs_review");
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
