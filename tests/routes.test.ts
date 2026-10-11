import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../src/app/page";
import InvestigatePage from "../src/app/investigate/page";
import DemoPage from "../src/app/demo/page";
import { SelfAuditSection } from "../src/app/home-client";

test("homepage presents product value and links to both workflows", () => {
  const html = renderToStaticMarkup(createElement(Home));
  assert.match(html, /Find invoice discrepancies/);
  assert.match(html, /href="\/investigate"/);
  assert.match(html, /href="\/demo"/);
});

test("investigation route retains the PDF workspace and shared route navigation", () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  env.NODE_ENV = "production";
  let html: string;
  try { html = renderToStaticMarkup(createElement(InvestigatePage)); }
  finally { if (previousNodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = previousNodeEnv; }
  assert.match(html, /Build an investigation/);
  assert.match(html, /printed ID inside each document/);
  assert.match(html, /href="\/demo"/);
  assert.match(html, /Live AI investigation requires authorized access/);
  assert.match(html, /disabled/);
});

test("demo route presents the synthetic scenarios and evidence notice", () => {
  const html = renderToStaticMarkup(createElement(DemoPage));
  assert.match(html, /Three ways to examine a case/);
  assert.match(html, /Potential overcharge/);
  assert.match(html, /Two prices disagree/);
  assert.match(html, /Demonstration data only/);
  assert.match(html, /href="\/investigate"/);
});

test("self-audit presentation labels supported, review, and rejected dispositions with evidence context", () => {
  const checks = [{ name: "Source citations", result: "passed" as const, explanation: "Exact excerpts verified." }, { name: "PO price agreement", result: "not_verified" as const, explanation: "A conflicting amendment requires review." }];
  const base = { proposedFinding: "Potential invoice overcharge", checks, supportingEvidence: [{ field: "unitPrice", sourceId: "I-001", page: 1, excerpt: "price 525" }], contradictoryEvidence: [{ field: "unitPrice", sourceId: "A-001", page: 1, excerpt: "price 540" }], explanation: "A human must review the evidence." };
  for (const disposition of ["supported", "needs_review", "rejected"] as const) {
    const html = renderToStaticMarkup(createElement(SelfAuditSection, { audit: { ...base, disposition } }));
    assert.match(html, new RegExp(disposition === "needs_review" ? "NEEDS REVIEW" : disposition.toUpperCase()));
    assert.match(html, /Source citations/);
    assert.match(html, /UNKNOWN/);
    assert.match(html, /I-001 · p\.1/);
    assert.match(html, /A-001 · p\.1/);
    assert.match(html, /not an approved payment claim/);
  }
});
