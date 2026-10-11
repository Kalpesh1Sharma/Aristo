import { investigate, type InvestigationResult } from "./investigation";

type Citation = { value: unknown; sourceId: string; page: number; excerpt: string };
type FactDocument = {
  type: string;
  id?: Citation;
  supplierId?: Citation;
  currency?: Citation;
  validFrom?: Citation;
  contractId?: Citation | string;
  effectiveFrom?: Citation;
  orderedAt?: Citation;
  purchaseOrderId?: Citation;
  issuedAt?: Citation;
  prices?: { sku: Citation; unitPrice: Citation }[];
  items?: { sku: Citation; quantity: Citation; unitPrice: Citation }[];
};
type Fixture = { docs: { id: string; type: string; pages: { page: number; text: string }[] }[]; facts: { documents: FactDocument[] } };
type Scenario = { id: string; name: string; condition: string; expected: string; explanation: string; provenance: string; unsupported: boolean; mutate: (f: Fixture) => void };

function fixture({ billed = 120, amendment = false, conflict = false } = {}): Fixture {
  const docs: Fixture["docs"] = [
    { id: "C1", type: "contract", pages: [{ page: 1, text: "Contract C1 Supplier S1 INR valid 2025-01-01 SKU-X price 100" }] },
    ...(amendment ? [{ id: "A1", type: "amendment", pages: [{ page: 1, text: `Amendment A1 Supplier S1 contract C1 INR effective 2025-06-01 SKU-X price ${conflict ? 115 : 110}` }] }] : []),
    { id: "P1", type: "purchase_order", pages: [{ page: 1, text: `PO P1 Supplier S1 contract C1 INR 2025-07-01 SKU-X quantity 10 price ${amendment ? 110 : 100}` }] },
    { id: "I1", type: "invoice", pages: [{ page: 1, text: `Invoice I1 Supplier S1 PO P1 INR 2025-07-02 SKU-X quantity 10 price ${billed}` }] }
  ];
  const cite = (value: unknown, d: Fixture["docs"][number]) => ({ value, sourceId: d.id, page: 1, excerpt: d.pages[0].text });
  const c = docs.find(d => d.type === "contract")!; const p = docs.find(d => d.type === "purchase_order")!; const i = docs.find(d => d.type === "invoice")!; const a = docs.find(d => d.type === "amendment");
  const documents: FactDocument[] = [
    { type: "contract", id: cite("C1", c), supplierId: cite("S1", c), currency: cite("INR", c), validFrom: cite("2025-01-01", c), prices: [{ sku: cite("SKU-X", c), unitPrice: cite(100, c) }] },
    ...(a ? [{ type: "amendment", id: cite("A1", a), supplierId: cite("S1", a), contractId: cite("C1", a), currency: cite("INR", a), effectiveFrom: cite("2025-06-01", a), prices: [{ sku: cite("SKU-X", a), unitPrice: cite(conflict ? 115 : 110, a) }] }] : []),
    { type: "purchase_order", id: cite("P1", p), supplierId: cite("S1", p), contractId: cite("C1", p), currency: cite("INR", p), orderedAt: cite("2025-07-01", p), items: [{ sku: cite("SKU-X", p), quantity: cite(10, p), unitPrice: cite(amendment ? 110 : 100, p) }] },
    { type: "invoice", id: cite("I1", i), supplierId: cite("S1", i), purchaseOrderId: cite("P1", i), currency: cite("INR", i), issuedAt: cite("2025-07-02", i), items: [{ sku: cite("SKU-X", i), quantity: cite(10, i), unitPrice: cite(billed, i) }] }
  ];
  return { docs, facts: { documents } };
}

const unchanged = () => {};
const scenarios: Scenario[] = [
  { id: "overcharge", name: "Genuine invoice overcharge", condition: "Invoice ₹120/unit; contract and PO ₹100/unit; quantity 10.", expected: "supported", explanation: "Verified source facts support a ₹200 potential discrepancy for human review.", provenance: "tests/investigation.test.ts · genuine overcharge", unsupported: false, mutate: unchanged },
  { id: "correct", name: "Correctly priced invoice", condition: "Invoice, contract, and PO all price SKU-X at ₹100/unit.", expected: "rejected", explanation: "No overcharge claim is supported by the matching prices.", provenance: "tests/investigation.test.ts · clean invoice", unsupported: true, mutate: unchanged },
  { id: "amendment-conflict", name: "Amendment conflicts with PO", condition: "Amendment says ₹115; PO remains ₹110; invoice says ₹120.", expected: "needs_review", explanation: "Conflicting amendment and PO terms prevent selecting a governing price.", provenance: "tests/investigation.test.ts · conflicting amendment and PO pricing", unsupported: true, mutate: f => { const a = f.facts.documents.find(d => d.type === "amendment")!; a.prices![0].unitPrice.value = 115; } },
  { id: "revised-po", name: "Valid amendment and revised PO", condition: "Amendment and revised PO agree at ₹110; invoice is ₹110.", expected: "rejected", explanation: "The effective amendment and matching PO eliminate the discrepancy.", provenance: "tests/investigation.test.ts · valid newer amendment supersedes old price", unsupported: true, mutate: unchanged },
  { id: "unsupported-quote", name: "Unsupported source quotation", condition: "Contract price citation is replaced with text absent from its page.", expected: "needs_review", explanation: "Exact excerpt verification fails; no financial claim is accepted.", provenance: "tests/investigation.test.ts · unsupported quotes and invalid model response", unsupported: true, mutate: f => { f.facts.documents[0].prices![0].unitPrice.excerpt = "fabricated quotation"; } },
  { id: "identity", name: "Supplier identity mismatch", condition: "Invoice supplier ID differs from the contract and PO.", expected: "needs_review", explanation: "Supplier mismatch stops the finding from being promoted.", provenance: "tests/investigation.test.ts · supplier identity change", unsupported: true, mutate: f => { const i = f.facts.documents.find(d => d.type === "invoice")!; i.supplierId!.value = "S2"; } },
  { id: "date", name: "Contract outside effective dates", condition: "Contract begins after the invoice date.", expected: "needs_review", explanation: "The invoice falls outside the contract validity period.", provenance: "tests/investigation.test.ts · contract effective date mismatch", unsupported: true, mutate: f => { f.facts.documents[0].validFrom!.value = "2025-08-01"; } },
  { id: "po-reference", name: "Missing PO contract reference", condition: "PO contractId citation is absent.", expected: "needs_review", explanation: "Required PO relationship evidence is missing, so the result is withheld.", provenance: "tests/investigation.test.ts · PO contractId structural validation", unsupported: true, mutate: f => { delete f.facts.documents.find(d => d.type === "purchase_order")!.contractId; } },
  { id: "po-reference-malformed", name: "Malformed PO contract reference", condition: "PO contractId is a bare string without source citation fields.", expected: "needs_review", explanation: "Malformed relationship evidence is rejected; the price comparison is not accepted.", provenance: "tests/investigation.test.ts · PO contractId structural validation", unsupported: true, mutate: f => { f.facts.documents.find(d => d.type === "purchase_order")!.contractId = "C1"; } },
];

export type EvaluationRow = { id: string; name: string; condition: string; expected: string; actual: string; passed: boolean; explanation: string; provenance: string; unsupported: boolean };
export async function runEvaluation(): Promise<EvaluationRow[]> {
  const rows: EvaluationRow[] = [];
  for (const s of scenarios) {
    const f = fixture({ amendment: s.id === "amendment-conflict" || s.id === "revised-po", conflict: s.id === "amendment-conflict", billed: s.id === "correct" ? 100 : s.id === "revised-po" ? 110 : 120 }); s.mutate(f);
    const result: InvestigationResult = await investigate({ documents: f.docs }, async () => f.facts);
    const actual = result.selfAudit?.[0]?.disposition ?? "needs_review";
    rows.push({ id: s.id, name: s.name, condition: s.condition, expected: s.expected, actual, passed: actual === s.expected, explanation: result.selfAudit?.[0]?.explanation || s.explanation, provenance: s.provenance, unsupported: s.unsupported && actual !== "supported" });
  }
  return rows;
}
