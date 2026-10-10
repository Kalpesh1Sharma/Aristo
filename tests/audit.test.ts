import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { auditDocuments } from "../src/lib/audit";
const base = JSON.parse(readFileSync(new URL("../fixtures/audit.json",import.meta.url),"utf8"));
test("finds synthetic INR 18000 overcharge",()=>{ const result=auditDocuments(base);assert.equal(result.totalPotentialOvercharge,18000);assert.equal(result.findings[0].status,"potential_overcharge"); });
test("clean invoice has zero overcharge",()=>{const v=structuredClone(base);v.invoices[0].items[0].unitPrice=480;assert.equal(auditDocuments(v).totalPotentialOvercharge,0)});
test("out-of-validity contract requires review and makes no claim",()=>{const v=structuredClone(base);v.invoices[0].issuedAt="2026-11-04";const res=auditDocuments(v);assert.equal(res.totalPotentialOvercharge,0);assert.equal(res.status,"needs_review")});
test("PO disagreement must not become false claim",()=>{const v=structuredClone(base);v.purchaseOrder.items[0].unitPrice=490;const res=auditDocuments(v);assert.equal(res.totalPotentialOvercharge,0);assert.equal(res.findings[0].status,"needs_review")});
