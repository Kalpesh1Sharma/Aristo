import assert from "node:assert/strict";
import test from "node:test";
import { buildReportModel } from "../src/lib/report-model";

const evidence = [
  { field: "contract price", sourceId: "C-1", page: 2, excerpt: "Contract price INR 480" },
  { field: "PO price", sourceId: "P-1", page: 1, excerpt: "PO quantity 400 price INR 480" },
  { field: "invoice price", sourceId: "I-1", page: 3, excerpt: "Invoice quantity 400 price INR 525" },
  { field: "amendment price", sourceId: "A-1", page: 1, excerpt: "Amendment price INR 525" }
];

test("supported report labels a potential amount and retains exact cited evidence", () => {
  const model = buildReportModel("completed", [{ invoiceId: "I-1", sku: "SKU-X", reason: "price variance", status: "potential_overcharge", expectedUnitPrice: 480, billedUnitPrice: 525, quantity: 400, potentialOvercharge: 18000 }], [{ disposition: "supported", contradictoryEvidence: [] }], evidence);
  assert.equal(model.disposition, "supported");
  assert.equal(model.potentialOvercharge, 18000);
  assert.deepEqual(model.citations, evidence);
});

test("needs_review report suppresses any case total and requires unresolved labeling", () => {
  const model = buildReportModel("needs_review", [{ invoiceId: "I-1", sku: "SKU-X", reason: "conflicting price", status: "needs_review", billedUnitPrice: 525, quantity: 400, potentialOvercharge: 0 }], [{ disposition: "needs_review", contradictoryEvidence: [evidence[3]] }], evidence);
  assert.equal(model.disposition, "needs_review");
  assert.equal(model.potentialOvercharge, null);
  assert.deepEqual(model.established, []);
  assert.deepEqual(model.contradictions, [evidence[3]]);
});

test("rejected report does not present zero as a confirmed recovery value", () => {
  const model = buildReportModel("completed", [], [{ disposition: "rejected", contradictoryEvidence: [] }], evidence);
  assert.equal(model.disposition, "rejected");
  assert.equal(model.potentialOvercharge, null);
});

test("report excludes malformed citations and contradictory references absent from source evidence", () => {
  const model = buildReportModel("completed", [], [{ disposition: "rejected", contradictoryEvidence: [evidence[3], { sourceId: "fake", page: 99, excerpt: "invented" }] }], [...evidence, { field: "invalid", sourceId: "bad", page: 0, excerpt: "invalid page" }]);
  assert.equal(model.citations.some(ref => ref.sourceId === "bad"), false);
  assert.deepEqual(model.contradictions, [evidence[3]]);
});
