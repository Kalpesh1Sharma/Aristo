import { z } from "zod";
import { auditDocuments } from "./audit";
import { extractedFactsSchema, sourceDocumentSchema, type ExtractedFacts, type SourceDocument } from "./schema";
import { tracedExtraction, tracedInvestigation, tracedMatching, tracedRetry, tracedVerification } from "./observability";

const requestSchema = z.object({ documents: z.array(sourceDocumentSchema).min(3).max(25) }).strict();
export type ModelExtractor = (docs: SourceDocument[]) => Promise<unknown>;
export type InvestigationResult = { state: "completed" | "needs_review"; case: ReturnType<typeof auditDocuments> | null; evidence: { field: string; sourceId: string; page: number; excerpt: string }[]; warnings: string[]; states: string[] };

export async function extractWithConfiguredProvider(docs: SourceDocument[]): Promise<unknown> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY is not configured");
  const endpoint = process.env.LLM_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Extract only facts explicitly stated in the supplied documents. Return JSON {documents:[...]}; document type fields: contract, amendment, purchase_order, invoice. Every scalar fact must be {value,sourceId,page,excerpt}; every item SKU, quantity, unitPrice must be separately cited. Excerpts must be exact substrings of the cited page text. Use INR only when stated. Omit uncertain fields; never infer. Contract prices are prices entries. Amendment prices are replacement prices with effectiveFrom and optional effectiveTo." }, { role: "user", content: JSON.stringify(docs) }] }) });
  if (!response.ok) throw new Error(`Extraction provider returned HTTP ${response.status}`);
  const body: unknown = await response.json();
  const parsed = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) }).parse(body);
  return JSON.parse(parsed.choices[0].message.content);
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
    if (!doc) throw new Error(`Unsupported citation source for ${citation.field}`);
    const page = doc.pages.find(p => p.page === citation.page);
    if (!page || !page.text.includes(citation.excerpt)) throw new Error(`Evidence quote does not match source for ${citation.field}`);
  }
  for (const d of facts.documents) {
    const id = "id" in d ? d.id.value : "";
    const source = sources.get(d.id.sourceId);
    if (!source || source.type !== d.type || source.id !== id) throw new Error("Extracted document identity or type conflicts with uploaded source");
  }
}

export async function investigate(untrusted: unknown, extractor: ModelExtractor = extractWithConfiguredProvider): Promise<InvestigationResult> {
  const input = requestSchema.parse(untrusted);
  const states: InvestigationResult["states"] = ["extract"];
  let candidate: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      candidate = await tracedExtraction(() => extractor(input.documents));
      const facts = extractedFactsSchema.parse(candidate);
      states.push("match");
      await tracedMatching(async () => { verify(facts, input.documents); });
      states.push("investigate");
      const result = await tracedInvestigation(() => buildCase(facts, input.documents, states));
      states.push("verify");
      return await tracedVerification(async () => ({ ...result, states: [...result.states.slice(0, -1), "verify", result.state] }));
    } catch (e) {
      if (attempt === 0) { await tracedRetry(async () => undefined); continue; }
      return { state: "needs_review", case: null, evidence: [], warnings: [e instanceof Error ? e.message : "Invalid extraction"], states: [...states, "needs_review"] };
    }
  }
  return { state: "needs_review", case: null, evidence: [], warnings: ["Extraction failed"], states: [...states, "needs_review"] };
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
