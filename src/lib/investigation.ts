import { z } from "zod";
import { auditDocuments } from "./audit";
import { extractedFactsSchema, sourceDocumentSchema, type ExtractedFacts, type SourceDocument } from "./schema";
import { tracedExtraction, tracedInvestigation, tracedMatching, tracedVerification } from "./observability";

const requestSchema = z.object({ documents: z.array(sourceDocumentSchema).min(3).max(25) }).strict();
export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODEL = "openai/gpt-oss-20b";
const MAX_INPUT_CHARS = 24_000;
const MAX_OUTPUT_TOKENS = 1800;
const jsonString = { type: "string" } as const;
const jsonNumber = { type: "number" } as const;
const jsonPage = { type: "integer" } as const;
const citationJsonSchema = (value: object) => ({
  type: "object",
  properties: { value, sourceId: jsonString, page: jsonPage, excerpt: jsonString },
  required: ["value", "sourceId", "page", "excerpt"],
  additionalProperties: false
});
const priceJsonSchema = {
  type: "object",
  properties: { sku: citationJsonSchema(jsonString), unitPrice: citationJsonSchema(jsonNumber) },
  required: ["sku", "unitPrice"],
  additionalProperties: false
};
const lineItemJsonSchema = {
  type: "object",
  properties: { sku: citationJsonSchema(jsonString), quantity: citationJsonSchema(jsonNumber), unitPrice: citationJsonSchema(jsonNumber) },
  required: ["sku", "quantity", "unitPrice"],
  additionalProperties: false
};
const nullableObject = (schema: { type: string; [key: string]: unknown }) => ({ ...schema, type: ["object", "null"] });
const nullableArray = (schema: { type: string; [key: string]: unknown }) => ({ ...schema, type: ["array", "null"] });
const extractedDocumentJsonSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["contract", "amendment", "purchase_order", "invoice"] },
    id: citationJsonSchema(jsonString),
    supplierId: citationJsonSchema(jsonString),
    currency: citationJsonSchema({ type: "string", enum: ["INR"] }),
    contractId: nullableObject(citationJsonSchema(jsonString)),
    purchaseOrderId: nullableObject(citationJsonSchema(jsonString)),
    validFrom: nullableObject(citationJsonSchema(jsonString)),
    validTo: nullableObject(citationJsonSchema(jsonString)),
    effectiveFrom: nullableObject(citationJsonSchema(jsonString)),
    effectiveTo: nullableObject(citationJsonSchema(jsonString)),
    orderedAt: nullableObject(citationJsonSchema(jsonString)),
    issuedAt: nullableObject(citationJsonSchema(jsonString)),
    prices: nullableArray({ type: "array", items: priceJsonSchema }),
    items: nullableArray({ type: "array", items: lineItemJsonSchema })
  },
  required: ["type", "id", "supplierId", "currency", "contractId", "purchaseOrderId", "validFrom", "validTo", "effectiveFrom", "effectiveTo", "orderedAt", "issuedAt", "prices", "items"],
  additionalProperties: false
};
const groqFactsJsonSchema = {
  type: "object",
  properties: { documents: { type: "array", items: extractedDocumentJsonSchema } },
  required: ["documents"],
  additionalProperties: false
};
const extractionSystemPrompt = `Extract explicitly stated facts only. Return one JSON object matching the supplied JSON Schema, with one document per input document. The schema requires null placeholders for fields inapplicable to that document type; use null only for those fields or an unstated optional validTo/effectiveTo. Never use null for a required applicable fact.
Every factual field must be a citation object exactly shaped as {"value": ..., "sourceId": "...", "page": 1, "excerpt": "..."}. Keep numeric values numeric, page numbers integers, dates YYYY-MM-DD strings, and currency INR. Each excerpt must be an exact substring from that sourceId and page and must support the value. Never transfer a citation between documents, infer facts, or fabricate missing citations. Preserve each input document's ID and type exactly; use only contract, purchase_order, invoice, amendment.
The following synthetic example shows the citation and type-specific nested structure. Its values and citations are illustrative only; never copy them. In the response, also include every schema-required field that is inapplicable to a type as null. Use the actual supplied source text and cite each claim from its own source page:
{"documents":[{"type":"contract","id":{"value":"C1","sourceId":"C1","page":1,"excerpt":"Contract C1"},"supplierId":{"value":"S1","sourceId":"C1","page":1,"excerpt":"Supplier S1"},"currency":{"value":"INR","sourceId":"C1","page":1,"excerpt":"INR"},"validFrom":{"value":"2025-01-01","sourceId":"C1","page":1,"excerpt":"2025-01-01"},"prices":[{"sku":{"value":"SKU-X","sourceId":"C1","page":1,"excerpt":"SKU-X"},"unitPrice":{"value":100,"sourceId":"C1","page":1,"excerpt":"100"}}]},{"type":"purchase_order","id":{"value":"P1","sourceId":"P1","page":1,"excerpt":"PO P1"},"supplierId":{"value":"S1","sourceId":"P1","page":1,"excerpt":"Supplier S1"},"contractId":{"value":"C1","sourceId":"P1","page":1,"excerpt":"Contract C1"},"currency":{"value":"INR","sourceId":"P1","page":1,"excerpt":"INR"},"orderedAt":{"value":"2025-07-01","sourceId":"P1","page":1,"excerpt":"2025-07-01"},"items":[{"sku":{"value":"SKU-X","sourceId":"P1","page":1,"excerpt":"SKU-X"},"quantity":{"value":10,"sourceId":"P1","page":1,"excerpt":"quantity 10"},"unitPrice":{"value":100,"sourceId":"P1","page":1,"excerpt":"price 100"}}]},{"type":"invoice","id":{"value":"I1","sourceId":"I1","page":1,"excerpt":"Invoice I1"},"supplierId":{"value":"S1","sourceId":"I1","page":1,"excerpt":"Supplier S1"},"purchaseOrderId":{"value":"P1","sourceId":"I1","page":1,"excerpt":"PO P1"},"currency":{"value":"INR","sourceId":"I1","page":1,"excerpt":"INR"},"issuedAt":{"value":"2025-07-02","sourceId":"I1","page":1,"excerpt":"2025-07-02"},"items":[{"sku":{"value":"SKU-X","sourceId":"I1","page":1,"excerpt":"SKU-X"},"quantity":{"value":10,"sourceId":"I1","page":1,"excerpt":"quantity 10"},"unitPrice":{"value":120,"sourceId":"I1","page":1,"excerpt":"price 120"}}]}]}
For amendments, return type amendment with cited id, supplierId, contractId, currency, effectiveFrom, optional effectiveTo, and prices entries containing cited sku and unitPrice. Do not add fields. Do not output commentary or markdown.`;
export type ModelExtractor = (docs: SourceDocument[]) => Promise<unknown>;
export type DiagnosticCategory = "offline_mode" | "missing_configuration" | "invalid_configuration" | "input_limit" | "groq_http" | "timeout" | "network_error" | "invalid_json" | "schema_validation" | "missing_evidence" | "unsupported_evidence";
export type SafeDiagnostic = { category: DiagnosticCategory; status?: number; fields?: string[]; providerCode?: string; providerType?: string; param?: string; providerKeyword?: string };
export type InvestigationResult = { state: "completed" | "needs_review"; case: ReturnType<typeof auditDocuments> | null; evidence: { field: string; sourceId: string; page: number; excerpt: string }[]; warnings: string[]; states: string[]; diagnostic?: SafeDiagnostic };

class DiagnosticError extends Error {
  constructor(readonly diagnostic: SafeDiagnostic) { super(diagnostic.category); }
}
const safeFields = (paths: PropertyKey[][]) => {
  const allowed = new Set(["documents", "type", "id", "supplierId", "currency", "validFrom", "validTo", "effectiveFrom", "effectiveTo", "contractId", "purchaseOrderId", "issuedAt", "orderedAt", "prices", "items", "sku", "quantity", "unitPrice", "value", "sourceId", "page", "excerpt", "choices", "message", "content"]);
  return [...new Set(paths.map(path => path.map(part => typeof part === "number" ? `[${part}]` : allowed.has(String(part)) ? String(part) : "<key>").join(".").replace(/\.\[/g, "[")))];
};
const parseSafeFieldPath = (path: string): PropertyKey[] => (path.match(/[^.[\]]+|\[(\d+)\]/g) ?? []).map(part => {
  const index = /^\[(\d+)\]$/.exec(part);
  return index ? Number(index[1]) : part;
});
const sanitizeProviderValue = (value: unknown, allowed: readonly string[], identifierPattern: RegExp) => {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 100 && value <= 599) return String(value);
  if (typeof value !== "string") return "other";
  if (allowed.includes(value)) return value;
  // Provider identifiers are diagnostic enums, never free-text messages.
  return identifierPattern.test(value) ? value.slice(0, 80) : "other";
};
function safeGroqErrorDetails(body: unknown): Pick<SafeDiagnostic, "providerCode" | "providerType" | "param" | "providerKeyword"> {
  if (!body || typeof body !== "object") return {};
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return {};
  const fields = error as Record<string, unknown>;
  const identifier = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
  const providerCode = sanitizeProviderValue(fields.code, ["invalid_json_schema", "schema_validation_error", "unsupported_value", "invalid_value", "context_length_exceeded", "rate_limit_exceeded"], identifier);
  const providerType = sanitizeProviderValue(fields.type, ["invalid_request_error", "authentication_error", "permission_error", "rate_limit_error", "server_error"], identifier);
  const param = sanitizeProviderValue(fields.param, ["response_format", "response_format.json_schema", "response_format.json_schema.schema", "model", "messages", "reasoning_effort", "max_completion_tokens", "temperature"], identifier);
  const message = typeof fields.message === "string" ? fields.message.toLowerCase() : "";
  const providerKeyword = ["anyof", "additionalproperties", "required", "items", "properties", "enum", "integer", "nullable", "type"]
    .find(keyword => message.includes(keyword));
  const messageParam = ["response_format.json_schema.schema", "response_format.json_schema", "response_format", "reasoning_effort", "max_completion_tokens", "temperature", "model", "messages"]
    .find(name => message.includes(name));
  return {
    ...(providerCode ? { providerCode } : {}),
    ...(providerType ? { providerType } : {}),
    ...(param ? { param } : messageParam ? { param: messageParam } : {}),
    ...(providerKeyword ? { providerKeyword } : {})
  };
}

function normalizeModelFacts(candidate: unknown, sources: SourceDocument[]): unknown {
  if (!candidate || typeof candidate !== "object" || !Array.isArray((candidate as { documents?: unknown }).documents)) return candidate;
  const modelDocs = (candidate as { documents: unknown[] }).documents;
  if (modelDocs.length !== sources.length) throw new DiagnosticError({ category: "unsupported_evidence", fields: ["documents"] });
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const seen = new Set<string>();
  const typeAliases: Record<string, SourceDocument["type"]> = {
    contract: "contract", amendment: "amendment", invoice: "invoice",
    purchase_order: "purchase_order", "purchase order": "purchase_order",
    "purchase-order": "purchase_order", purchaseorder: "purchase_order", po: "purchase_order"
  };
  return {
    ...(candidate as Record<string, unknown>),
    documents: modelDocs.map((value, index) => {
      if (!value || typeof value !== "object") return value;
      const document = value as Record<string, unknown>;
      const idFact = document.id;
      if (!idFact || typeof idFact !== "object") return value;
      const identity = idFact as Record<string, unknown>;
      const source = typeof identity.sourceId === "string" ? sourceById.get(identity.sourceId) : undefined;
      if (!source || seen.has(source.id) || identity.value !== source.id) {
        throw new DiagnosticError({ category: "unsupported_evidence", fields: [`documents[${index}].id`] });
      }
      seen.add(source.id);
      const rawType = document.type;
      const type = typeof rawType === "string" ? typeAliases[rawType.trim().toLowerCase()] : undefined;
      if (!type || type !== source.type) {
        throw new DiagnosticError({ category: "unsupported_evidence", fields: [`documents[${index}].type`] });
      }
      const normalized: Record<string, unknown> = { ...document, type };
      for (const [key, field] of Object.entries(normalized)) if (field === null) delete normalized[key];
      return normalized;
    })
  };
}

export async function extractWithConfiguredProvider(docs: SourceDocument[]): Promise<unknown> {
  if ((process.env.LLM_MODE || "offline") !== "groq_free") throw new DiagnosticError({ category: "offline_mode" });
  const endpoint = process.env.LLM_API_URL || GROQ_ENDPOINT;
  const model = process.env.LLM_MODEL || GROQ_MODEL;
  if (endpoint !== GROQ_ENDPOINT || model !== GROQ_MODEL) throw new DiagnosticError({ category: "invalid_configuration" });
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new DiagnosticError({ category: "missing_configuration" });
  const serialized = JSON.stringify(docs);
  if (serialized.length > MAX_INPUT_CHARS) throw new DiagnosticError({ category: "input_limit" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(GROQ_ENDPOINT, { method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: GROQ_MODEL, reasoning_effort: "low", temperature: 0, max_completion_tokens: MAX_OUTPUT_TOKENS, response_format: { type: "json_schema", json_schema: { name: "margin_ghost_facts", strict: true, schema: groqFactsJsonSchema } }, messages: [{ role: "system", content: extractionSystemPrompt }, { role: "user", content: serialized }] }) });
    if (!response.ok) {
      let details: Pick<SafeDiagnostic, "providerCode" | "providerType" | "param" | "providerKeyword"> = {};
      if (response.status === 400) {
        try { details = safeGroqErrorDetails(await response.json()); } catch { /* provider error body is optional; never expose it */ }
      }
      throw new DiagnosticError({ category: "groq_http", status: response.status, ...details });
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw new DiagnosticError({ category: "invalid_json" }); }
    let content: string;
    try {
      const parsed = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) }).parse(body);
      content = parsed.choices[0].message.content;
    } catch (error) {
      if (error instanceof z.ZodError) throw new DiagnosticError({ category: "schema_validation", fields: safeFields(error.issues.map(issue => issue.path)) });
      throw error;
    }
    try { return JSON.parse(content); } catch { throw new DiagnosticError({ category: "invalid_json" }); }
  } catch (error) {
    if (error instanceof DiagnosticError) throw error;
    if (controller.signal.aborted) throw new DiagnosticError({ category: "timeout" });
    throw new DiagnosticError({ category: "network_error" });
  } finally { clearTimeout(timeout); }
}

const allFacts = (v: unknown, path = ""): { field: string; sourceId: string; page: number; excerpt: string }[] => {
  if (Array.isArray(v)) return v.flatMap((x, i) => allFacts(x, `${path}[${i}]`));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("sourceId" in o && "page" in o && "excerpt" in o) return [{ field: path, sourceId: String(o.sourceId), page: Number(o.page), excerpt: String(o.excerpt) }];
    return Object.entries(o).flatMap(([k, x]) => allFacts(x, path ? `${path}.${k}` : k));
  }
  return [];
};

function verify(facts: ExtractedFacts, docs: SourceDocument[]) {
  const sources = new Map(docs.map(d => [d.id, d]));
  for (const citation of allFacts(facts)) {
    const doc = sources.get(citation.sourceId);
    if (!doc) throw new DiagnosticError({ category: "unsupported_evidence", fields: safeFields([parseSafeFieldPath(citation.field)]) });
    const page = doc.pages.find(p => p.page === citation.page);
    if (!page || !page.text.includes(citation.excerpt)) throw new DiagnosticError({ category: "missing_evidence", fields: safeFields([parseSafeFieldPath(citation.field)]) });
  }
  for (const d of facts.documents) {
    const id = "id" in d ? d.id.value : "";
    const source = sources.get(d.id.sourceId);
    if (!source || source.type !== d.type || source.id !== id) throw new DiagnosticError({ category: "unsupported_evidence", fields: ["documents"] });
  }
}

export async function investigate(untrusted: unknown, extractor: ModelExtractor = extractWithConfiguredProvider): Promise<InvestigationResult> {
  const input = requestSchema.parse(untrusted);
  const states: InvestigationResult["states"] = ["extract"];
  let candidate: unknown;
  try {
      candidate = await tracedExtraction(() => extractor(input.documents));
      const reconciled = normalizeModelFacts(candidate, input.documents);
      const facts = extractedFactsSchema.parse(reconciled);
      states.push("match");
      await tracedMatching(async () => { verify(facts, input.documents); });
      states.push("investigate");
      const result = await tracedInvestigation(() => buildCase(facts, input.documents, states));
      states.push("verify");
      return await tracedVerification(async () => ({ ...result, states: [...result.states.slice(0, -1), "verify", result.state] }));
  } catch (error) {
      const diagnostic = error instanceof DiagnosticError ? error.diagnostic : error instanceof z.ZodError ? { category: "schema_validation" as const, fields: safeFields(error.issues.map(issue => issue.path)) } : { category: "schema_validation" as const };
      return { state: "needs_review", case: null, evidence: [], warnings: ["Extraction failed; manual review is required"], states: [...states, "needs_review"], diagnostic };
  }
}

async function buildCase(facts: ExtractedFacts, docs: SourceDocument[], states: InvestigationResult["states"]): Promise<InvestigationResult> {
  const contracts = facts.documents.filter((d): d is ExtractedFacts["documents"][number] & { type: "contract" } => d.type === "contract");
  const amendments = facts.documents.filter(d => d.type === "amendment");
  const pos = facts.documents.filter(d => d.type === "purchase_order");
  const invoices = facts.documents.filter(d => d.type === "invoice");
  if (contracts.length !== 1 || pos.length !== 1 || !invoices.length || facts.documents.length !== 1 + pos.length + invoices.length + amendments.length) return review("Expected one contract, one PO, at least one invoice, and any amendments", states);
  const base = contracts[0];
  const po = pos[0];
  const inv = invoices;
  if (base.supplierId.value !== po.supplierId.value || base.id.value !== po.contractId.value || inv.some(i => i.supplierId.value !== base.supplierId.value || i.purchaseOrderId.value !== po.id.value)) return review("Supplier, contract, or PO references conflict", states);
  const applicable = amendments.filter(a => a.contractId.value === base.id.value && a.supplierId.value === base.supplierId.value && a.effectiveFrom.value <= inv[0].issuedAt.value && (!a.effectiveTo || inv[0].issuedAt.value <= a.effectiveTo.value));
  if (amendments.some(a => a.contractId.value !== base.id.value || a.supplierId.value !== base.supplierId.value)) return review("Amendment references a different supplier or contract", states);
  applicable.sort((a, b) => a.effectiveFrom.value.localeCompare(b.effectiveFrom.value));
  if (applicable.length > 1 && applicable.at(-1)!.effectiveFrom.value === applicable.at(-2)!.effectiveFrom.value) return review("Conflicting amendments have the same effective date", states);
  const amendment = applicable.at(-1);
  const prices = new Map(base.prices.map(x => [x.sku.value, x.unitPrice.value]));
  for (const a of applicable) for (const p of a.prices) prices.set(p.sku.value, p.unitPrice.value);
  const contract = { type: "contract", id: base.id.value, supplierId: base.supplierId.value, currency: base.currency.value, validFrom: amendment?.effectiveFrom.value ?? base.validFrom.value, ...(amendment?.effectiveTo ? { validTo: amendment.effectiveTo.value } : base.validTo ? { validTo: base.validTo.value } : {}), prices: [...prices].map(([sku, unitPrice]) => ({ sku, unitPrice })), evidence: amendment ? amendment.prices.map(p => p.unitPrice.excerpt).join("; ") : base.prices.map(p => p.unitPrice.excerpt).join("; ") };
  const toSimple = (d: typeof po | typeof inv[number]) => ({ type: d.type, id: d.id.value, supplierId: d.supplierId.value, ...(d.type === "purchase_order" ? { contractId: d.contractId.value, orderedAt: d.orderedAt.value } : { purchaseOrderId: d.purchaseOrderId.value, issuedAt: d.issuedAt.value }), currency: d.currency.value, items: d.items.map(x => ({ sku: x.sku.value, quantity: x.quantity.value, unitPrice: x.unitPrice.value })) });
  const audit = auditDocuments({ contract, purchaseOrder: toSimple(po), invoices: inv.map(toSimple) });
  const citations = allFacts(facts).filter(c => c.sourceId && docs.some(d => d.id === c.sourceId));
  const evidence = citations.map(c => ({ ...c }));
  const warnings = audit.warnings;
  if (warnings.length || audit.status === "needs_review") return { state: "needs_review", case: audit, evidence, warnings, states: [...states, "needs_review"] };
  return { state: "completed", case: audit, evidence, warnings, states: [...states, "completed"] };
}
function review(message: string, states: InvestigationResult["states"]): InvestigationResult { return { state: "needs_review", case: null, evidence: [], warnings: [message], states: [...states, "needs_review"] }; }
