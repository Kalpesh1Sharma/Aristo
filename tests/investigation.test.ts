import assert from "node:assert/strict";
import test from "node:test";
import { investigate } from "../src/lib/investigation";

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
