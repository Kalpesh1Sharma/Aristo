import { z } from "zod";
import { auditDocuments } from "./audit";
import { extractedFactsSchema, sourceDocumentSchema, type ExtractedFacts, type SourceDocument } from "./schema";
import { tracedExtraction, tracedInvestigation, tracedMatching, tracedVerification, tracedChallenge, tracedDecision } from "./observability";

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
const exampleCitation = (value: string | number, sourceId: string, excerpt: string) => ({ value, sourceId, page: 1, excerpt });
export const GROQ_EXTRACTION_EXAMPLE = {
  documents: [
    {
      type: "contract", id: exampleCitation("C1", "C1", "Contract C1"), supplierId: exampleCitation("S1", "C1", "Supplier S1"), currency: exampleCitation("INR", "C1", "INR"),
      contractId: null, purchaseOrderId: null, validFrom: exampleCitation("2025-01-01", "C1", "valid 2025-01-01"), validTo: null, effectiveFrom: null, effectiveTo: null, orderedAt: null, issuedAt: null,
      prices: [{ sku: exampleCitation("SKU-X", "C1", "SKU-X"), unitPrice: exampleCitation(100, "C1", "price INR 100") }], items: null
    },
    {
      type: "purchase_order", id: exampleCitation("P1", "P1", "PO P1"), supplierId: exampleCitation("S1", "P1", "Supplier S1"), currency: exampleCitation("INR", "P1", "INR"),
      contractId: exampleCitation("C1", "P1", "Contract C1"), purchaseOrderId: null, validFrom: null, validTo: null, effectiveFrom: null, effectiveTo: null, orderedAt: exampleCitation("2025-07-01", "P1", "ordered 2025-07-01"), issuedAt: null,
      prices: null, items: [{ sku: exampleCitation("SKU-X", "P1", "SKU-X"), quantity: exampleCitation(10, "P1", "qty 10"), unitPrice: exampleCitation(100, "P1", "price INR 100") }]
    },
    {
      type: "invoice", id: exampleCitation("I1", "I1", "Invoice I1"), supplierId: exampleCitation("S1", "I1", "Supplier S1"), currency: exampleCitation("INR", "I1", "INR"),
      contractId: null, purchaseOrderId: exampleCitation("P1", "I1", "PO P1"), validFrom: null, validTo: null, effectiveFrom: null, effectiveTo: null, orderedAt: null, issuedAt: exampleCitation("2025-07-02", "I1", "issued 2025-07-02"),
      prices: null, items: [{ sku: exampleCitation("SKU-X", "I1", "SKU-X"), quantity: exampleCitation(10, "I1", "qty 10"), unitPrice: exampleCitation(120, "I1", "price INR 120") }]
    }
  ]
} as const;
const extractionSystemPrompt = `Extract explicitly stated facts only. Return one JSON object matching the supplied JSON Schema, with one document per input document. Every schema property is required. Use null for fields inapplicable to that document type and for an unstated optional validTo/effectiveTo only. Never use null for a required applicable fact.
For every purchase_order document, contractId is required and must be a complete citation object, never null or omitted. When the PO prints a reference such as "contract C-001", return {"value":"C-001","sourceId":"<that PO's input ID>","page":<printed page number>,"excerpt":"<exact substring containing contract C-001>"}. Do not use the PO's own ID or filename as the contract value, and do not infer or fabricate a citation if the reference is absent or unclear.
Every factual field must be a citation object exactly shaped as {"value": ..., "sourceId": "...", "page": 1, "excerpt": "..."}. Keep numeric values numeric, page numbers integers, dates YYYY-MM-DD strings, and currency INR. Each excerpt must be an exact substring from that sourceId and page and must support the value. Never transfer a citation between documents, infer facts, or fabricate missing citations. Preserve each input document's ID and type exactly; use only contract, purchase_order, invoice, amendment.
The following synthetic example shows the citation and type-specific nested structure. Every object includes all schema-required keys, with null only for inapplicable fields and unstated optional dates. Its values and citations are illustrative only; never copy them. Use the actual supplied source text and cite each claim from its own source page:
${JSON.stringify(GROQ_EXTRACTION_EXAMPLE)}
For each amendment input, return one amendment object with cited id, supplierId, contractId, currency, effectiveFrom, optional effectiveTo, and prices entries containing cited sku and unitPrice. Include all schema-required keys; set purchaseOrderId, validFrom, validTo, orderedAt, issuedAt, and items to null where inapplicable, and effectiveTo to null when unstated. Do not add fields. Do not output commentary or markdown.`;
export type ModelExtractor = (docs: SourceDocument[]) => Promise<unknown>;
export type DiagnosticCategory = "offline_mode" | "missing_configuration" | "invalid_configuration" | "input_limit" | "groq_http" | "timeout" | "network_error" | "invalid_json" | "schema_validation" | "missing_evidence" | "unsupported_evidence" | "investigation_error";
export type StructuralFailure = { field: string; reason: "missing" | "null" | "wrong_type" | "invalid_value" | "unknown_structure" };
export type SafeDiagnostic = { category: DiagnosticCategory; status?: number; fields?: string[]; structuralFailures?: StructuralFailure[]; providerCode?: string; providerType?: string; param?: string; providerKeyword?: string; providerFailureStage?: "generated_output" | "request_schema" | "unknown" };
export type EvidenceReference = { field: string; sourceId: string; page: number; excerpt: string };
export type SelfAudit = { proposedFinding: string; checks: { name: string; result: "passed" | "failed" | "not_verified"; explanation: string }[]; supportingEvidence: EvidenceReference[]; contradictoryEvidence: EvidenceReference[]; disposition: "supported" | "rejected" | "needs_review"; explanation: string };
export type InvestigationResult = { state: "completed" | "needs_review"; case: ReturnType<typeof auditDocuments> | null; evidence: EvidenceReference[]; warnings: string[]; states: string[]; selfAudit?: SelfAudit[]; diagnostic?: SafeDiagnostic };

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
function valueAtPath(value: unknown, path: PropertyKey[]): unknown {
  let current = value;
  for (const part of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<PropertyKey, unknown>)[part];
  }
  return current;
}
function structuralFailures(error: z.ZodError, candidate?: unknown): StructuralFailure[] {
  return error.issues.map(issue => {
    let reason: StructuralFailure["reason"] = "invalid_value";
    if (issue.code === "invalid_type") {
      const input = valueAtPath(candidate, issue.path);
      reason = input === undefined ? "missing" : input === null ? "null" : "wrong_type";
    } else if (issue.code === "unrecognized_keys") reason = "unknown_structure";
    return { field: safeFields([issue.path])[0] ?? "<root>", reason };
  });
}
const safeSchemaDiagnostic = (error: z.ZodError, candidate?: unknown): SafeDiagnostic => ({ category: "schema_validation", fields: safeFields(error.issues.map(issue => issue.path)), structuralFailures: structuralFailures(error, candidate) });
const sanitizeProviderValue = (value: unknown, allowed: readonly string[], identifierPattern: RegExp) => {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 100 && value <= 599) return String(value);
  if (typeof value !== "string") return "other";
  if (allowed.includes(value)) return value;
  // Provider identifiers are diagnostic enums, never free-text messages.
  return identifierPattern.test(value) ? value.slice(0, 80) : "other";
};
function safeGroqErrorDetails(body: unknown): Pick<SafeDiagnostic, "providerCode" | "providerType" | "param" | "providerKeyword" | "providerFailureStage"> {
  if (!body || typeof body !== "object") return {};
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return {};
  const fields = error as Record<string, unknown>;
  const identifier = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
  const providerCode = sanitizeProviderValue(fields.code, ["invalid_json_schema", "json_validate_failed", "schema_validation_error", "unsupported_value", "invalid_value", "context_length_exceeded", "rate_limit_exceeded"], identifier);
  const providerType = sanitizeProviderValue(fields.type, ["invalid_request_error", "authentication_error", "permission_error", "rate_limit_error", "server_error"], identifier);
  const param = sanitizeProviderValue(fields.param, ["response_format", "response_format.json_schema", "response_format.json_schema.schema", "model", "messages", "reasoning_effort", "max_completion_tokens", "temperature"], identifier);
  const message = typeof fields.message === "string" ? fields.message.toLowerCase() : "";
  const providerFailureStage = typeof fields.failed_generation === "string" || ["generated json", "generated output", "failed_generation", "failed generation"].some(phrase => message.includes(phrase))
    ? "generated_output" as const
    : param === "response_format.json_schema.schema" || ["invalid_json_schema", "response_format.json_schema", "schema is invalid", "unsupported schema"].some(phrase => message.includes(phrase))
      ? "request_schema" as const
      : "unknown" as const;
  const providerKeyword = ["anyof", "additionalproperties", "required", "items", "properties", "enum", "integer", "nullable", "type"]
    .find(keyword => message.includes(keyword));
  const messageParam = ["response_format.json_schema.schema", "response_format.json_schema", "response_format", "reasoning_effort", "max_completion_tokens", "temperature", "model", "messages"]
    .find(name => message.includes(name));
  return {
    ...(providerCode ? { providerCode } : {}),
    ...(providerType ? { providerType } : {}),
    ...(param ? { param } : messageParam ? { param: messageParam } : {}),
    ...(providerKeyword ? { providerKeyword } : {}),
    providerFailureStage
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
      if (error instanceof z.ZodError) throw new DiagnosticError(safeSchemaDiagnostic(error, body));
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
      states.push("challenge");
      const result = await tracedInvestigation(() => buildCase(facts, input.documents, states));
      return { ...result, states: [...result.states.slice(0, -1), result.state] };
  } catch (error) {
      const diagnostic = error instanceof DiagnosticError ? error.diagnostic : error instanceof z.ZodError ? safeSchemaDiagnostic(error, candidate) : { category: "investigation_error" as const };
      const inputValidationFailed = diagnostic.category !== "investigation_error";
      return { state: "needs_review", case: null, evidence: [], warnings: [diagnostic.category === "investigation_error" ? "Investigation could not establish a verified result; manual review is required" : "Extraction failed; manual review is required"], states: [...states, "needs_review"], diagnostic, selfAudit: [reviewAudit("A potential invoice overcharge could not be assessed.", [{ name: "Fact extraction and citation validation", result: inputValidationFailed ? "failed" : "not_verified", explanation: inputValidationFailed ? `Input extraction or validation stopped with ${diagnostic.category}; no financial finding was accepted.` : "The investigation stopped before it could record whether extracted facts passed validation." }, { name: "Document relationships", result: "not_verified", explanation: "Document identity and relationship checks did not produce a completed audit." }, { name: "Contract, amendment, and PO terms", result: "not_verified", explanation: "Applicable pricing terms could not be established for disposition." }, { name: "Invoice comparison and arithmetic", result: "not_verified", explanation: "No amount was calculated or treated as zero." }]) ] };
  }
}

async function buildCase(facts: ExtractedFacts, docs: SourceDocument[], states: InvestigationResult["states"]): Promise<InvestigationResult> {
  const citations = allFacts(facts).filter(c => c.sourceId && docs.some(d => d.id === c.sourceId));
  const evidence = citations.map(c => ({ ...c }));
  const contracts = facts.documents.filter((d): d is ExtractedFacts["documents"][number] & { type: "contract" } => d.type === "contract");
  const amendments = facts.documents.filter(d => d.type === "amendment");
  const pos = facts.documents.filter(d => d.type === "purchase_order");
  const invoices = facts.documents.filter(d => d.type === "invoice");
  if (contracts.length !== 1 || pos.length !== 1 || !invoices.length || facts.documents.length !== 1 + pos.length + invoices.length + amendments.length) return review("Expected one contract, one PO, at least one invoice, and any amendments", states, [reviewAudit("Potential invoice overcharge", [{ name: "Fact citation verification", result: "passed", explanation: "All extracted facts passed exact source-page excerpt verification." }, { name: "Required document set", result: "failed", explanation: "The required one-contract, one-PO, and at-least-one-invoice structure was not met." }, { name: "Price comparison", result: "not_verified", explanation: "The financial comparison did not run." }], evidence)]);
  const base = contracts[0];
  const po = pos[0];
  const inv = invoices;
  if (base.supplierId.value !== po.supplierId.value || base.id.value !== po.contractId.value || inv.some(i => i.supplierId.value !== base.supplierId.value || i.purchaseOrderId.value !== po.id.value)) {
    const contradiction = evidence.filter(e => [base.id.value, po.id.value, ...inv.map(i => i.id.value)].includes(e.sourceId) && ["supplierId", "contractId", "purchaseOrderId"].some(field => e.field.endsWith(field)));
    return review("Supplier, contract, or PO references conflict", states, [reviewAudit("Potential invoice overcharge", [{ name: "Fact citation verification", result: "passed", explanation: "The identity facts cited here match their source pages." }, { name: "Supplier, contract, and PO relationships", result: "failed", explanation: "At least one supplied identity or document reference conflicts." }, { name: "Price comparison", result: "not_verified", explanation: "No claim amount or zero result was established." }], [], contradiction)]);
  }
  const amendmentAt = (date: string) => amendments.filter(a => a.contractId.value === base.id.value && a.supplierId.value === base.supplierId.value && a.effectiveFrom.value <= date && (!a.effectiveTo || date <= a.effectiveTo.value)).sort((a, b) => a.effectiveFrom.value.localeCompare(b.effectiveFrom.value)).at(-1);
  const applicable = amendments.filter(a => a.contractId.value === base.id.value && a.supplierId.value === base.supplierId.value && a.effectiveFrom.value <= inv[0].issuedAt.value && (!a.effectiveTo || inv[0].issuedAt.value <= a.effectiveTo.value));
  if (amendments.some(a => a.contractId.value !== base.id.value || a.supplierId.value !== base.supplierId.value)) {
    const contradiction = evidence.filter(e => amendments.some(a => a.id.value === e.sourceId) && (e.field.endsWith("contractId") || e.field.endsWith("supplierId")));
    return review("Amendment references a different supplier or contract", states, [reviewAudit("Potential invoice overcharge", [{ name: "Fact citation verification", result: "passed", explanation: "The amendment identity citations match their source pages." }, { name: "Amendment relationship", result: "failed", explanation: "An amendment names a different supplier or contract." }, { name: "Applicable price comparison", result: "not_verified", explanation: "The amendment conflict prevents selecting a governing price." }], [], contradiction)]);
  }
  applicable.sort((a, b) => a.effectiveFrom.value.localeCompare(b.effectiveFrom.value));
  if (applicable.length > 1 && applicable.at(-1)!.effectiveFrom.value === applicable.at(-2)!.effectiveFrom.value) return review("Conflicting amendments have the same effective date", states, [reviewAudit("Potential invoice overcharge", [{ name: "Fact citation verification", result: "passed", explanation: "Amendment facts passed exact source-page verification." }, { name: "Amendment effective-date selection", result: "failed", explanation: "Multiple applicable amendments share the latest effective date." }, { name: "Price comparison", result: "not_verified", explanation: "A single governing price could not be selected." }], [], evidence.filter(e => applicable.slice(-2).some(a => a.id.value === e.sourceId)))]);
  if (inv.some(i => (amendmentAt(i.issuedAt.value)?.id.value ?? "base") !== (amendmentAt(inv[0].issuedAt.value)?.id.value ?? "base"))) return review("Invoices span different amendment periods; compare each period separately", states, [reviewAudit("Potential invoice overcharge", [{ name: "Fact citation verification", result: "passed", explanation: "Invoice and amendment dates passed source-page verification." }, { name: "Amendment period consistency", result: "failed", explanation: "The invoices fall under different selected amendment terms." }, { name: "Price comparison", result: "not_verified", explanation: "A single price schedule was not applied across different amendment periods." }], [], evidence.filter(e => e.field.endsWith("issuedAt") || e.field.endsWith("effectiveFrom") || e.field.endsWith("effectiveTo")))]);
  const amendment = applicable.at(-1);
  const prices = new Map(base.prices.map(x => [x.sku.value, x.unitPrice.value]));
  for (const a of applicable) for (const p of a.prices) prices.set(p.sku.value, p.unitPrice.value);
  const contract = { type: "contract", id: base.id.value, supplierId: base.supplierId.value, currency: base.currency.value, validFrom: amendment?.effectiveFrom.value ?? base.validFrom.value, ...(amendment?.effectiveTo ? { validTo: amendment.effectiveTo.value } : base.validTo ? { validTo: base.validTo.value } : {}), prices: [...prices].map(([sku, unitPrice]) => ({ sku, unitPrice })), evidence: amendment ? amendment.prices.map(p => p.unitPrice.excerpt).join("; ") : base.prices.map(p => p.unitPrice.excerpt).join("; ") };
  const toSimple = (d: typeof po | typeof inv[number]) => ({ type: d.type, id: d.id.value, supplierId: d.supplierId.value, ...(d.type === "purchase_order" ? { contractId: d.contractId.value, orderedAt: d.orderedAt.value } : { purchaseOrderId: d.purchaseOrderId.value, issuedAt: d.issuedAt.value }), currency: d.currency.value, items: d.items.map(x => ({ sku: x.sku.value, quantity: x.quantity.value, unitPrice: x.unitPrice.value })) });
  const audit = auditDocuments({ contract, purchaseOrder: toSimple(po), invoices: inv.map(toSimple) });
  const priceEvidence = evidence.filter(e => (e.field.includes("unitPrice") || e.field.includes("quantity") || e.field.endsWith("sku")) && [base.id.value, po.id.value, ...inv.map(i => i.id.value), ...applicable.map(a => a.id.value)].includes(e.sourceId));
  const dateEvidence = evidence.filter(e => (e.field.endsWith("validFrom") || e.field.endsWith("validTo") || e.field.endsWith("effectiveFrom") || e.field.endsWith("effectiveTo") || e.field.endsWith("issuedAt")) && [base.id.value, ...inv.map(i => i.id.value), ...applicable.map(a => a.id.value)].includes(e.sourceId));
  const relationshipEvidence = evidence.filter(e => ["id", "supplierId", "contractId", "purchaseOrderId"].some(field => e.field.endsWith(field)) && [base.id.value, po.id.value, ...inv.map(i => i.id.value)].includes(e.sourceId));
  const reviewFindings = audit.findings.filter(f => f.status === "needs_review");
  const potentialFindings = audit.findings.filter(f => f.status === "potential_overcharge");
  const reviewRequired = audit.warnings.length > 0 || audit.status === "needs_review";
  const contradiction = [...priceEvidence.filter(e => amendments.some(a => a.id.value === e.sourceId && a.prices.some(p => p.unitPrice.sourceId === e.sourceId && p.unitPrice.value !== po.items.find(x => x.sku.value === p.sku.value)?.unitPrice.value))), ...reviewFindings.flatMap(f => priceEvidence.filter(e => e.sourceId === f.invoiceId || e.sourceId === po.id.value))];
  const challenged = await tracedChallenge(() => ({
    proposedFinding: potentialFindings.length
      ? potentialFindings.map(f => `${f.invoiceId} · ${f.sku}: ${f.reason}`).join("; ")
      : "Potential invoice overcharge across checked invoice lines",
    checks: [
      { name: "Source citations", result: "passed" as const, explanation: "Extracted facts used in this audit matched their cited source IDs, pages, and exact excerpts." },
      { name: "Supplier, contract, and PO relationships", result: "passed" as const, explanation: "Contract, PO, and invoice supplier and document references were compared and reconciled." },
      { name: "Contract and amendment dates", result: audit.warnings.some(w => w.includes("outside contract validity")) ? "failed" as const : "passed" as const, explanation: audit.warnings.some(w => w.includes("outside contract validity")) ? "An invoice date fell outside the selected contract validity window." : applicable.length ? "Applicable amendments were selected by contract, supplier, and invoice effective dates." : "The supplied amendments were checked against the invoice dates; base contract terms were used for the checked period." },
      { name: "SKU, PO price, and ordered quantity", result: reviewFindings.length ? "failed" as const : "passed" as const, explanation: reviewFindings.length ? reviewFindings.map(f => `${f.invoiceId} ${f.sku}: ${f.reason}`).join("; ") : "Each checked invoice SKU matched contract and PO lines, PO price agreed with the selected contract price, and invoiced quantity did not exceed ordered quantity." },
      { name: "Invoice price comparison and arithmetic", result: reviewRequired || reviewFindings.length ? "not_verified" as const : "passed" as const, explanation: reviewRequired || reviewFindings.length ? "One or more warnings or lines lacked a verified baseline, so the overall price result is not final." : potentialFindings.length ? "Unit price differences and line amounts were calculated deterministically in integer paise." : "The completed comparison found no checked invoice line above its selected agreed price." }
    ],
    supportingEvidence: [...priceEvidence, ...dateEvidence, ...relationshipEvidence],
    contradictoryEvidence: [...new Map(contradiction.map(e => [`${e.field}:${e.sourceId}:${e.page}`, e])).values()],
    explanation: reviewRequired ? "The investigation found an unresolved check. No verified zero or approved claim is reported." : potentialFindings.length ? "The deterministic comparison supports a potential overcharge finding. A human must review the cited evidence; this is not an approved payment claim." : "The checked evidence does not support the proposed overcharge hypothesis."
  }));
  const verified = await tracedVerification(async () => {
    const refs = [...challenged.supportingEvidence, ...challenged.contradictoryEvidence];
    const intact = refs.every(ref => docs.some(doc => doc.id === ref.sourceId && doc.pages.some(page => page.page === ref.page && page.text.includes(ref.excerpt))));
    return intact ? challenged : { ...challenged, checks: challenged.checks.map(check => check.name === "Source citations" ? { ...check, result: "failed" as const, explanation: "A supporting or contradictory evidence reference failed exact source-page re-verification." } : check), explanation: "The cited audit references could not all be reverified; manual review is required." };
  });
  states.push("verify");
  const selfAudit = await tracedDecision(() => [{
    ...verified,
    disposition: verified.checks.some(check => check.result === "failed" || check.result === "not_verified") || reviewRequired ? "needs_review" as const : potentialFindings.length ? "supported" as const : "rejected" as const
  }]);
  states.push("decide");
  const warnings = audit.warnings;
  if (warnings.length || audit.status === "needs_review") return { state: "needs_review", case: audit, evidence, warnings, states: [...states, "needs_review"], selfAudit };
  return { state: "completed", case: audit, evidence, warnings, states: [...states, "completed"], selfAudit };
}
function reviewAudit(proposedFinding: string, checks: SelfAudit["checks"], supportingEvidence: EvidenceReference[] = [], contradictoryEvidence: EvidenceReference[] = []): SelfAudit {
  return { proposedFinding, checks, supportingEvidence, contradictoryEvidence, disposition: "needs_review", explanation: "The investigation stopped before the financial comparison could support or reject the overcharge hypothesis." };
}
function review(message: string, states: InvestigationResult["states"], selfAudit?: SelfAudit[]): InvestigationResult { return { state: "needs_review", case: null, evidence: [], warnings: [message], states: [...states, "needs_review"], selfAudit: selfAudit ?? [reviewAudit("Potential invoice overcharge", [{ name: "Document and citation validation", result: "not_verified", explanation: "The investigation could not complete the required checks." }, { name: "Financial comparison", result: "not_verified", explanation: "No claim amount or zero result was established." }])] }; }
