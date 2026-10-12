import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../src/app/page";
import InvestigatePage from "../src/app/investigate/page";
import DemoPage from "../src/app/demo/page";
import EvaluationPage from "../src/app/evaluation/page";
import { ReportSection, reviewerDecisionAvailable, ReviewerHandoff, SelfAuditSection } from "../src/app/home-client";
import { readFileSync } from "node:fs";

test("homepage presents product value and links to both workflows", () => {
  const html = renderToStaticMarkup(createElement(Home));
  assert.match(html, /Know what every invoice <em>should cost\.<\/em>/);
  assert.match(html, /Live processing is restricted to authorized Judge Preview sessions/);
  assert.match(html, /href="\/investigate"/);
  assert.match(html, /href="\/demo"/);
  assert.match(html, /href="\/evaluation"/);
});

test("production investigation route shows the closed preview state without rendering a live form", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousPreview = env.JUDGE_PREVIEW_ENABLED;
  env.NODE_ENV = "production";
  let html: string;
  env.JUDGE_PREVIEW_ENABLED = "false";
  try { html = renderToStaticMarkup(await InvestigatePage()); }
  finally {
    if (previousNodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = previousNodeEnv;
    if (previousPreview === undefined) delete env.JUDGE_PREVIEW_ENABLED; else env.JUDGE_PREVIEW_ENABLED = previousPreview;
  }
  assert.match(html, /Preview access is unavailable/);
  assert.match(html, /href="\/demo"/);
  assert.doesNotMatch(html, /Build an investigation/);
  assert.doesNotMatch(html, /type="file"/);
});

test("local investigation route renders the existing document workspace", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousDemoMode = env.DEMO_MODE;
  env.NODE_ENV = "development";
  env.DEMO_MODE = "false";
  try {
    const html = renderToStaticMarkup(await InvestigatePage());
    assert.match(html, /Build an investigation/);
    assert.match(html, /printed ID inside each document/);
    assert.match(html, /href="\/demo"/);
  } finally {
    if (previousNodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = previousNodeEnv;
    if (previousDemoMode === undefined) delete env.DEMO_MODE; else env.DEMO_MODE = previousDemoMode;
  }
});

test("demo route presents the synthetic scenarios and evidence notice", () => {
  const html = renderToStaticMarkup(createElement(DemoPage));
  assert.match(html, /Three ways to examine a case/);
  assert.match(html, /Potential overcharge/);
  assert.match(html, /Two prices disagree/);
  assert.match(html, /Demonstration data only/);
  assert.match(html, /href="\/investigate"/);
});

test("evaluation route executes fixed scenarios and labels deterministic scope", async () => {
  const html = renderToStaticMarkup(await EvaluationPage());
  assert.match(html, /Reliability under adversarial conditions/);
  assert.match(html, /DETERMINISTIC REGRESSION/);
  assert.match(html, /DETERMINISTIC SCENARIOS PASSED/);
  assert.match(html, /9 expected outcomes observed/);
  assert.match(html, /Genuine invoice overcharge/);
  assert.match(html, /Unsupported source quotation/);
  assert.match(html, /not an LLM benchmark/);
  assert.doesNotMatch(html, /href="\/api\//);
});

test("shared navigation exposes the four public routes and an accessible theme switch", async () => {
  const { default: Navigation } = await import("../src/app/navigation");
  const html = renderToStaticMarkup(createElement(Navigation, { current: "demo" }));
  assert.match(html, /aria-label="Main navigation"/);
  assert.match(html, /href="\/demo"/);
  assert.match(html, /href="\/evaluation"/);
  assert.match(html, /aria-label="Switch to light mode"/);
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

test("reviewer handoff exposes evidence review and report export with disposition-aware status", () => {
  const finding = { invoiceId: "I-001", sku: "SKU-X", status: "potential_overcharge" as const, expectedUnitPrice: 480, billedUnitPrice: 525, quantity: 400, potentialOvercharge: 18000, reason: "Price difference", evidence: [] };
  const audit = (disposition: "supported" | "needs_review" | "rejected") => ({ proposedFinding: "Invoice discrepancy", checks: [], supportingEvidence: [], contradictoryEvidence: [], disposition, explanation: "Review evidence." });
  const result = (disposition: "supported" | "needs_review" | "rejected") => ({ state: "completed" as const, case: { status: "completed" as const, currency: "INR" as const, totalPotentialOvercharge: 18000, findings: [finding], checkedInvoices: 1, warnings: [] }, evidence: [], warnings: [], selfAudit: [audit(disposition)] });
  const supported = renderToStaticMarkup(createElement(ReviewerHandoff, { result: result("supported") }));
  assert.match(supported, /Awaiting human review/);
  assert.match(supported, /href="#evidence-review-target"/);
  assert.match(supported, /Review evidence/);
  assert.match(supported, /Export evidence report/);
  assert.match(supported, /independently verify the finding/);
  assert.match(supported, /contract, purchase-order, and invoice citations/);
  assert.match(supported, /Approve finding for further review/);
  assert.match(supported, /Reject finding/);
  assert.match(supported, /Reset decision/);
  assert.match(supported, /Optional reviewer note/);
  assert.match(supported, /temporary, held only in this page session, and are not saved or transmitted/);
  assert.match(supported, /does not mean approved payment, confirmed recovery, or an authorized dispute/);
  const review = renderToStaticMarkup(createElement(ReviewerHandoff, { result: { ...result("needs_review"), state: "needs_review" } }));
  assert.match(review, /Needs review/);
  assert.doesNotMatch(review, /Awaiting human review/);
  assert.doesNotMatch(review, /Approve finding for further review|Reject finding/);
  const rejected = renderToStaticMarkup(createElement(ReviewerHandoff, { result: result("rejected") }));
  assert.match(rejected, /Rejected/);
  assert.doesNotMatch(rejected, /Awaiting human review/);
  assert.doesNotMatch(rejected, /Approve finding for further review|Reject finding/);
  const incomplete = { ...result("supported"), case: null };
  assert.equal(reviewerDecisionAvailable(result("supported")), true);
  assert.equal(reviewerDecisionAvailable(result("needs_review")), false);
  assert.equal(reviewerDecisionAvailable(result("rejected")), false);
  assert.equal(reviewerDecisionAvailable(incomplete), false);
});

test("reviewer handoff styles use theme-aware contrast, visible focus, and a narrow-screen layout", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.reviewer-handoff h2 \{[^}]*color: var\(--ink\)/);
  assert.match(css, /\.reviewer-handoff p \{[^}]*color: var\(--muted\)/);
  assert.match(css, /\.decision-button[^}]*background: var\(--surface\);[^}]*color: var\(--ink\)/);
  assert.match(css, /\.reviewer-handoff textarea:focus-visible[^}]*outline: 3px solid var\(--forest\)/);
  assert.match(css, /\.reviewer-handoff textarea \{[^}]*background: var\(--surface\);[^}]*color: var\(--ink\)/);
  assert.match(css, /\.reviewer-handoff \{[^}]*grid-template-columns: 1fr/);
  assert.match(css, /\.decision-actions \{[^}]*flex-direction: column/);
});

test("investigation report keeps evidence and assigns readable disposition states", () => {
  const fixture = (disposition: "supported" | "needs_review" | "rejected"): Parameters<typeof ReportSection>[0]["result"] => {
    const review = disposition === "needs_review";
    const supported = disposition === "supported";
    const checks = Array.from({ length: 5 }, (_, index) => ({ name: `Self-audit check ${index + 1}`, result: review && index === 4 ? "not_verified" as const : "passed" as const, explanation: "Evidence check explanation." }));
    return {
      state: review ? "needs_review" : "completed",
      case: { status: review ? "needs_review" : "completed", currency: "INR", totalPotentialOvercharge: supported ? 18000 : 0, findings: supported ? [{ invoiceId: "I-001", sku: "SKU-X", status: "potential_overcharge", expectedUnitPrice: 480, billedUnitPrice: 525, quantity: 400, potentialOvercharge: 18000, reason: "Price difference", evidence: [] }] : [], checkedInvoices: 1, warnings: review ? ["Price could not be verified"] : [] },
      evidence: [{ field: "unitPrice", sourceId: "C-001", page: 1, excerpt: "Contract price INR 480" }],
      warnings: review ? ["Price could not be verified"] : [],
      selfAudit: [{ proposedFinding: "Invoice finding", checks, supportingEvidence: [{ field: "unitPrice", sourceId: "C-001", page: 1, excerpt: "Contract price INR 480" }], contradictoryEvidence: [], disposition, explanation: "A reviewer must examine the evidence." }]
    };
  };
  for (const disposition of ["supported", "needs_review", "rejected"] as const) {
    const html = renderToStaticMarkup(createElement(ReportSection, { result: fixture(disposition) }));
    assert.match(html, new RegExp(`report-status-${disposition}`));
    assert.match(html, /Self-audit check 5/);
    assert.match(html, /Contract price INR 480/);
    assert.match(html, /A qualified person must review source documents/);
    if (disposition === "supported") assert.match(html, /Calculation: \(₹525 − ₹480\) × 400 = ₹18,000/);
  }
});

test("report screen colors follow theme tokens and print forces white paper with dark nested text", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--report-supported: #b5f0bd/);
  assert.match(css, /--report-review: #f1c879/);
  assert.match(css, /--report-rejected: #f0a097/);
  assert.match(css, /--report-supported:#184F3B/);
  assert.match(css, /--report-review:#795317/);
  assert.match(css, /\.report-comparison, \.report-evidence blockquote[^}]*background:var\(--surface-muted\)[^}]*color:var\(--ink\)/);
  assert.match(css, /\.report-action \.secondary-button:hover:not\(:disabled\)/);
  assert.match(css, /\.report-action \.secondary-button:disabled/);
  assert.match(css, /\.report-action \.secondary-button:focus-visible/);
  assert.match(css, /\.report-action \.secondary-button\[aria-pressed="true"\]/);
  assert.match(css, /\.investigation-report \{ max-width:100%; min-width:0; overflow-wrap:anywhere/);
  assert.match(css, /@media print \{[^]*\.investigation-report, \.investigation-report \* \{ background:#fff !important; background-color:#fff !important; color:#111 !important/);
  assert.match(css, /\.investigation-report \.report-synthetic[^}]*color:#111 !important/);
  assert.match(css, /\.investigation-report \.report-amount[^}]*color:#111 !important/);
  assert.match(css, /\.report-audit, \.report-comparison, \.report-evidence blockquote[^}]*break-inside:avoid/);
});
