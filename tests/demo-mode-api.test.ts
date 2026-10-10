import assert from "node:assert/strict";
import test from "node:test";
import { POST as investigatePost } from "../src/app/api/investigate/route";
import { POST as ingestPost } from "../src/app/api/ingest/pdf/route";
import { extractPdfPages } from "../src/lib/pdf-ingestion";
import { auditDocuments } from "../src/lib/audit";
import { readFile } from "node:fs/promises";

async function fixtureText(name: string) {
  const bytes = new Uint8Array(await readFile(new URL(`../fixtures/live-demo/${name}.pdf`, import.meta.url)));
  return (await extractPdfPages(bytes))[0].text;
}

function audit(unitContract: number, unitPo: number, unitInvoice = 525) {
  return auditDocuments({
    contract: { type: "contract", id: "C-001", supplierId: "S1", currency: "INR", validFrom: "2026-01-01", prices: [{ sku: "SKU-X", unitPrice: unitContract }], evidence: "SKU-X price" },
    purchaseOrder: { type: "purchase_order", id: "P-001", supplierId: "S1", contractId: "C-001", currency: "INR", orderedAt: "2026-09-01", items: [{ sku: "SKU-X", quantity: 400, unitPrice: unitPo }] },
    invoices: [{ type: "invoice", id: "I-001", supplierId: "S1", purchaseOrderId: "P-001", currency: "INR", issuedAt: "2026-09-03", items: [{ sku: "SKU-X", quantity: 400, unitPrice: unitInvoice }] }]
  });
}

test("the three synthetic scenarios match fixture evidence and deterministic outcomes", async () => {
  const [contract, po, invoice, amendment, revisedPo] = await Promise.all([
    fixtureText("contract"), fixtureText("purchase-order"), fixtureText("invoice"), fixtureText("amendment"), fixtureText("purchase-order-amended")
  ]);
  assert.match(contract, /valid 2026-01-01 SKU-X price 480/);
  assert.match(po, /quantity 400 price 480/);
  assert.match(invoice, /quantity 400 price 525/);
  assert.match(amendment, /effective 2026-08-01 SKU-X price 525/);
  assert.match(revisedPo, /quantity 400 price 525/);
  assert.equal(audit(480, 480).totalPotentialOvercharge, 18000);
  const conflict = audit(525, 480);
  assert.equal(conflict.status, "needs_review");
  assert.equal(conflict.totalPotentialOvercharge, 0);
  assert.equal(audit(525, 525).totalPotentialOvercharge, 0);
});

test("demo mode rejects direct HTTP investigation requests before provider setup", async () => {
  const previous = process.env.DEMO_MODE;
  process.env.DEMO_MODE = "true";
  try {
    const response = await investigatePost(new Request("http://example.test/api/investigate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documents: [] })
    }));
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /disabled in synthetic demo mode/i);
  } finally {
    if (previous === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = previous;
  }
});

test("demo mode rejects direct multipart PDF ingestion requests before parsing", async () => {
  const previous = process.env.DEMO_MODE;
  process.env.DEMO_MODE = "true";
  try {
    const form = new FormData();
    form.set("file", new File(["not parsed"], "invoice.pdf", { type: "application/pdf" }));
    const response = await ingestPost(new Request("http://example.test/api/ingest/pdf", { method: "POST", body: form }));
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /PDF ingestion is disabled in synthetic demo mode/i);
  } finally {
    if (previous === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = previous;
  }
});
