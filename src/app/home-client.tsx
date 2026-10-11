"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { buildCaseEvaluation, buildReportModel } from "../lib/report-model";

type Kind = "contract" | "purchase_order" | "invoice" | "amendment";
type Doc = { key: string; kind: Kind; file: File; id: string; pages?: { page: number; text: string }[]; progress: number; error?: string };
type Finding = { invoiceId: string; sku: string; status: "potential_overcharge" | "needs_review"; expectedUnitPrice?: number; billedUnitPrice: number; quantity: number; potentialOvercharge?: number; reason: string; evidence: string[] };
type Case = { status: "completed" | "needs_review"; currency: "INR"; totalPotentialOvercharge: number; findings: Finding[]; checkedInvoices: number; warnings: string[] };
type Evidence = { field: string; sourceId: string; page: number; excerpt: string };
type SelfAudit = { proposedFinding: string; checks: { name: string; result: "passed" | "failed" | "not_verified"; explanation: string }[]; supportingEvidence: Evidence[]; contradictoryEvidence: Evidence[]; disposition: "supported" | "rejected" | "needs_review"; explanation: string };
type Result = { state: "completed" | "needs_review"; case: Case | null; evidence: Evidence[]; warnings: string[]; selfAudit?: SelfAudit[]; diagnostic?: { category: string; fields?: string[]; status?: number; providerCode?: string; providerFailureStage?: "generated_output" | "request_schema" | "unknown" } };
const labels: Record<Kind, string> = { contract: "Contract", purchase_order: "Purchase order", invoice: "Invoice", amendment: "Amendment" };
const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;
function explainError(status: number, body: unknown) {
  const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "The server returned an unreadable response.";
  if (status === 429) return "Rate limit reached. Wait a little, then choose Retry to submit again.";
  if (status === 413) return "The upload or request is too large. Each PDF must be 10 MB or smaller, and extracted text must fit the investigation API’s 1 MB request limit.";
  if (status === 415 || status === 422) return `${message} Check that the file is a readable, text based PDF.`;
  if (status === 403) return "Live investigation is unavailable in this deployment. Live extraction is restricted to local development.";
  if (status === 400) return `The request needs correction: ${message}`;
  return `${message} (HTTP ${status})`;
}

export default function HomeClient({ demoMode, liveDisabled = false }: { demoMode: boolean; liveDisabled?: boolean }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [stage, setStage] = useState<"idle" | "extracting" | "investigating" | "validating" | "finished" | "review" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [progress, setProgress] = useState("");
  const [demoInfo, setDemoInfo] = useState("");
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const sumInvoices = docs.filter(d => d.kind === "invoice").length;
  const uniqueIds = new Set(docs.map(d => d.id.trim()).filter(Boolean)).size === docs.filter(d => d.id.trim()).length;
  const filteredEvidence = useMemo(() => (result?.evidence ?? []).filter(e => `${e.field} ${e.sourceId} ${e.page} ${e.excerpt}`.toLowerCase().includes(filter.toLowerCase())), [result, filter]);
  const groupedEvidence = useMemo(() => filteredEvidence.reduce<Record<string, Evidence[]>>((groups, evidence) => {
    (groups[evidence.sourceId] ??= []).push(evidence);
    return groups;
  }, {}), [filteredEvidence]);
  const ready = docs.length >= 3 && docs.length <= 25 && docs.some(d => d.kind === "contract") && docs.some(d => d.kind === "purchase_order") && sumInvoices > 0 && uniqueIds && docs.every(d => d.id.trim() && d.id.trim().length <= 100 && d.file.size <= 10 * 1024 * 1024);

  const replay = (name: "overcharge" | "review" | "revised") => {
    const source = (sourceId: string, excerpt: string): Evidence => ({ field: "scenario source", sourceId, page: 1, excerpt });
    const baseEvidence = [
      source("C-001", "Contract C-001 Supplier S1 INR valid 2026-01-01 SKU-X price 480"),
      source("P-001", `PO P-001 Supplier S1 contract C-001 INR 2026-09-01 SKU-X quantity 400 price ${name === "revised" ? "525" : "480"}`),
      source("I-001", "Invoice I-001 Supplier S1 PO P-001 INR 2026-09-03 SKU-X quantity 400 price 525")
    ];
    const conflict = source("A-001", "Amendment A-001 Supplier S1 contract C-001 INR effective 2026-08-01 SKU-X price 525");
    const manual = name === "review";
    const amount = name === "overcharge" ? 18000 : 0;
    const outcome: Case = {
      status: manual ? "needs_review" : "completed", currency: "INR", totalPotentialOvercharge: amount,
      checkedInvoices: 1, warnings: manual ? ["Amendment price ₹525 conflicts with purchase order price ₹480; manual review is required."] : [],
      findings: manual ? [{ invoiceId: "I-001", sku: "SKU-X", status: "needs_review", billedUnitPrice: 525, quantity: 400, reason: "The amendment and purchase order disagree on the applicable unit price; resolve the conflict before assessing a claim.", evidence: [] }] : amount ? [{ invoiceId: "I-001", sku: "SKU-X", status: "potential_overcharge", expectedUnitPrice: 480, billedUnitPrice: 525, quantity: 400, potentialOvercharge: 18000, reason: "Invoice unit price exceeds the contract and purchase order price by ₹45 across 400 units.", evidence: [] }] : []
    };
    const evidence = manual ? [...baseEvidence.slice(0, 1), conflict, ...baseEvidence.slice(1)] : name === "revised" ? [...baseEvidence.slice(0, 1), conflict, ...baseEvidence.slice(1)] : baseEvidence;
    const selfAudit: SelfAudit[] = [{
      proposedFinding: manual ? "I-001 · SKU-X: amendment and PO prices conflict" : amount ? "I-001 · SKU-X: invoice price exceeds the agreed price by ₹45 × 400 units" : "I-001 · SKU-X: no overcharge at the revised ₹525 price",
      checks: ["Citation integrity", "Supplier and document identity", "Effective price and PO agreement", "Quantity and deterministic arithmetic"].map((name, index) => ({ name, result: manual && index === 2 ? "failed" : "passed", explanation: manual && index === 2 ? "Amendment says ₹525 while the PO says ₹480; a claim is not supported." : "Synthetic source excerpts and fixture values reconcile for this check." })),
      supportingEvidence: manual ? [baseEvidence[0], conflict] : baseEvidence,
      contradictoryEvidence: manual ? [conflict, baseEvidence[1]] : [],
      disposition: manual ? "needs_review" : amount ? "supported" : "rejected",
      explanation: manual ? "Conflicting amendment and PO evidence blocks promotion of an overcharge claim." : amount ? "The fixed synthetic prices and quantity deterministically produce ₹18,000; human review is still required." : "Amendment, revised PO, and invoice agree at ₹525 per unit."
    }];
    setResult({ state: manual ? "needs_review" : "completed", case: outcome, evidence, warnings: outcome.warnings, selfAudit });
    setFilter(""); setStage(manual ? "review" : "finished"); setDemoInfo("Synthetic scenario replay. Precomputed demonstration only; no AI inference or PDF upload was performed.");
  };

  if (demoMode) return <main className="shell">
    <header className="topbar"><Link className="brand" href="/" aria-label="MarginGhost home"><span className="brand-icon">M</span><span>MarginGhost <small>V0.4</small></span></Link><nav className="main-nav" aria-label="Main navigation"><Link href="/">Overview</Link><a href="/investigate">Investigate</a><a href="/demo">Synthetic demo</a><Link href="/evaluation">Evaluation</Link>{result && <a href="#results">Replay results</a>}</nav><span className="mode-pill"><i/> Synthetic demo</span></header>
    <section className="intro hero" id="top"><div className="eyebrow"><span className="dot"/> FINANCIAL CONTROL · INR</div><h1>Know what every invoice should cost.</h1><p>Compare supplier invoices with the contract and purchase order. Follow every discrepancy back to its source page.</p><a className="primary-button hero-action" href="#scenarios">Explore the scenarios <span aria-hidden="true">↓</span></a><div className="hero-note">A synthetic replay environment <span>·</span> No live model inference or PDF upload</div></section>
    <section className="demo-section" id="scenarios"><div className="section-heading"><div><div className="step">SYNTHETIC SCENARIO REPLAY</div><h2>Three ways to examine a case</h2></div><p>Choose a fixed example to inspect its outcome and source evidence.</p></div><div className="scenario-grid">
      <button aria-pressed={result?.case?.totalPotentialOvercharge === 18000} className={`scenario-card scenario-recovery ${result?.case?.totalPotentialOvercharge === 18000 ? "selected" : ""}`} onClick={() => replay("overcharge")}><span className="scenario-index">01 / PRICE VARIANCE</span><strong>₹18,000</strong><span className="scenario-title">Potential overcharge</span><span className="scenario-copy">Invoice exceeds the contract and PO by ₹45 across 400 units.</span><span className="scenario-link">Review case <b>↗</b></span></button>
      <button aria-pressed={result?.state === "needs_review"} className={`scenario-card scenario-review ${result?.state === "needs_review" ? "selected" : ""}`} onClick={() => replay("review")}><span className="scenario-index">02 / AMENDMENT CONFLICT</span><strong>Manual review</strong><span className="scenario-title">Two prices disagree</span><span className="scenario-copy">The amendment and purchase order do not agree on the applicable price.</span><span className="scenario-link">Resolve conflict <b>↗</b></span></button>
      <button aria-pressed={result?.state === "completed" && result.case?.totalPotentialOvercharge === 0} className={`scenario-card scenario-clear ${result?.state === "completed" && result.case?.totalPotentialOvercharge === 0 ? "selected" : ""}`} onClick={() => replay("revised")}><span className="scenario-index">03 / REVISED PURCHASE ORDER</span><strong>₹0</strong><span className="scenario-title">No potential overcharge</span><span className="scenario-copy">The amendment, revised PO and invoice agree at ₹525 per unit.</span><span className="scenario-link">Review case <b>↗</b></span></button>
    </div><div className="demo-disclosure" role="note"><span className="demo-disclosure-mark">i</span><span><strong>Demonstration data only.</strong> Replay results are precomputed examples, not live AI investigations. All names, dates and transaction details are synthetic.</span></div></section>
    {demoInfo && <p className="demo-banner" role="status">{demoInfo}</p>}
    {result && <section className="results" id="results" aria-live="polite"><div className="report-action"><button className="secondary-button" type="button" onClick={() => window.print()}>Print / Save report as PDF</button></div><ReportSection result={result} synthetic /><div className={`result-banner ${result.state === "needs_review" ? "review-banner" : "complete-banner"}`}><div><div className="step">SCENARIO RESULT <span className="result-demo-tag">· SYNTHETIC REPLAY</span></div><h2>{result.state === "needs_review" ? "Manual review required" : "Scenario replay complete"}</h2><p>{result.state === "needs_review" ? result.warnings[0] : result.case?.totalPotentialOvercharge ? "Potential discrepancy identified. Review the cited source evidence before taking action." : "The revised purchase order matches the invoice in this synthetic example."}</p></div><span className="status-chip">{result.state === "needs_review" ? "NEEDS REVIEW" : "COMPLETED"}</span></div>
      {result.state === "needs_review" && <div className="review-explainer"><strong>Do not treat this as a zero-overcharge result.</strong><span>The amendment is ₹525 per unit while the purchase order remains ₹480. A reviewer must resolve which price applies.</span></div>}
      <div className="metric-grid"><div className="metric-card metric-primary"><span>Potential overcharge</span><strong>{result.state === "needs_review" ? "Unresolved" : fmt(result.case!.totalPotentialOvercharge)}</strong><small>{result.state === "needs_review" ? "No claim amount assessed" : "Synthetic calculation · 400 units"}</small></div><div className="metric-card"><span>Invoices reviewed</span><strong>1</strong><small>I-001 fixture</small></div><div className="metric-card"><span>Findings</span><strong>{result.case!.findings.length || "None"}</strong><small>{result.state === "needs_review" ? "Requires human resolution" : "Illustrative only"}</small></div></div>
      <section className="card findings-card"><div className="section-head"><div><div className="step">DETERMINISTIC PRICE COMPARISON</div><h2>Scenario outcome</h2></div><span className="quiet-pill">INR · synthetic inputs</span></div>{result.state === "needs_review" ? <div className="finding-row"><div className="comparison"><div><small>Contract price</small><strong>₹480 / unit</strong></div><b aria-hidden="true">→</b><div><small>Amendment price</small><strong>₹525 / unit</strong></div><b aria-hidden="true">→</b><div><small>Purchase order</small><strong>₹480 / unit</strong></div><div><small>Invoice price</small><strong>₹525 / unit</strong></div><div className="line-total"><small>Resolution</small><strong>Manual review</strong></div></div></div> : result.case!.totalPotentialOvercharge ? <div className="finding-row"><div className="comparison"><div><small>Contract price</small><strong>₹480 / unit</strong></div><b aria-hidden="true">→</b><div><small>Purchase order</small><strong>₹480 / unit</strong></div><b aria-hidden="true">→</b><div><small>Invoice price</small><strong>₹525 / unit</strong></div><div><small>Quantity</small><strong>400</strong></div><div className="line-total"><small>Potential discrepancy</small><strong>₹18,000</strong></div></div></div> : <div className="zero-findings"><span className="zero-check">✓</span><div><strong>No potential overcharge in this synthetic case</strong><p>Amendment, revised purchase order, and invoice agree at ₹525 per unit.</p></div></div>}</section>
      {result.selfAudit?.map((item, index) => <SelfAuditSection key={`demo-audit-${index}`} audit={item} synthetic />)}
      <section className="card evidence-card"><div className="evidence-toolbar"><div><div className="step">SOURCE DOCUMENTS</div><h2>Evidence explorer</h2><p>Exact page excerpts from bundled synthetic PDFs.</p></div><label className="search-box"><span aria-hidden="true">⌕</span><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search evidence" aria-label="Search synthetic evidence"/></label></div>{Object.keys(groupedEvidence).length === 0 ? <p className="empty-evidence">No source excerpts match this search.</p> : <div className="evidence-list">{Object.entries(groupedEvidence).map(([sourceId, excerpts]) => <details id={`source-${encodeURIComponent(sourceId)}`} className="source-group" key={sourceId} open><summary><span className="source-doc-mark">PDF</span><span className="source-doc-title"><strong>{sourceId}</strong><small>{excerpts.length} source {excerpts.length === 1 ? "excerpt" : "excerpts"}</small></span><span className="source-pages">Page {excerpts[0].page}</span><span className="source-chevron" aria-hidden="true">⌄</span></summary><div className="source-excerpts">{excerpts.map((e, i) => <article className="evidence-item" key={`${e.page}-${e.field}-${i}`}><div className="evidence-meta"><span>PAGE {e.page}</span><span>{e.field.replaceAll(".", " / ").replaceAll("[", " ").replaceAll("]", "")}</span></div><blockquote>“{e.excerpt}”</blockquote></article>)}</div></details>)}</div>}</section>
      <p className="disclaimer">Synthetic demonstration only. Not a live AI investigation, accounting advice, approved claim, supplier communication, or payment instruction.</p>
    </section>}
    <section className="method-note" id="method"><span className="step">THE REVIEW STANDARD</span><p>Every discrepancy is a lead for a person to verify. MarginGhost does not approve claims, contact suppliers or change payments.</p></section><footer><span>MarginGhost <small>V0.4</small></span><span>Evidence first. Human reviewed.</span></footer>
  </main>;

  function add(kind: Kind, file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setError("PDF files only. Choose a PDF document."); return; }
    if (file.size > 10 * 1024 * 1024) { setError(`${file.name} is larger than the 10 MB upload limit.`); return; }
    if (docs.length >= 25) { setError("A case can contain up to 25 PDFs total."); return; }
    if (kind !== "invoice" && docs.some(d => d.kind === kind && d.key !== "")) {
      setError(`Only one ${labels[kind].toLowerCase()} is supported. Remove or replace the existing file first.`); return;
    }
    const key = `${kind}-${crypto.randomUUID()}`;
    setDocs(old => [...old, { key, kind, file, id: "", progress: 0 }]);
    setError(""); setResult(null); setStage("idle");
  }
  function replace(key: string, file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setError("PDF files only. Choose a PDF document."); return; }
    if (file.size > 10 * 1024 * 1024) { setError(`${file.name} is larger than the 10 MB upload limit.`); return; }
    setDocs(old => old.map(d => d.key === key ? { ...d, file, pages: undefined, progress: 0, error: undefined } : d)); setResult(null); setStage("idle"); setError("");
  }
  function update(key: string, update: Partial<Doc>) { setDocs(old => old.map(d => d.key === key ? { ...d, ...update } : d)); }
  function remove(key: string) { setDocs(old => old.filter(d => d.key !== key)); setResult(null); setStage("idle"); }

  async function investigate() {
    if (!ready) { setError("Add the required PDFs and enter each document’s printed ID before investigating."); return; }
    setResult(null); setError(""); setDemoInfo(""); setStage("extracting");
    const prepared: Doc[] = [];
    try {
      for (const doc of docs) {
        setProgress(`Uploading and extracting ${labels[doc.kind].toLowerCase()}: ${doc.file.name}`);
        update(doc.key, { progress: 0, error: undefined });
        const body = await new Promise<unknown>((resolve, reject) => {
          const request = new XMLHttpRequest(); request.open("POST", "/api/ingest/pdf"); request.timeout = 60_000;
          request.upload.onprogress = event => { if (event.lengthComputable) update(doc.key, { progress: Math.round(event.loaded / event.total * 75) }); };
          request.onerror = () => reject(new Error("Network error while uploading the PDF. Check your connection and retry."));
          request.ontimeout = () => reject(new Error("PDF upload or extraction timed out. Retry when ready."));
          request.onload = () => { let value: unknown; try { value = JSON.parse(request.responseText); } catch { value = null; }
            if (request.status < 200 || request.status >= 300) { reject(new Error(explainError(request.status, value))); return; }
            resolve(value);
          };
          const form = new FormData(); form.append("file", doc.file, doc.file.name); request.send(form);
        });
        update(doc.key, { progress: 90 });
        if (!body || typeof body !== "object" || !("pages" in body) || !Array.isArray(body.pages) || !body.pages.length || !body.pages.every((p: unknown) => !!p && typeof p === "object" && "page" in p && Number.isInteger(p.page) && "text" in p && typeof p.text === "string")) throw new Error(`${doc.file.name}: PDF extraction returned malformed page data. Replace the file or retry.`);
        const next = { ...doc, pages: body.pages as { page: number; text: string }[], progress: 100 };
        prepared.push(next); update(doc.key, { pages: next.pages, progress: 100 });
      }
      setStage("investigating"); setProgress("Sending extracted page text for investigation…");
      const payload = { documents: prepared.map(d => ({ id: d.id.trim(), type: d.kind, pages: d.pages! })) };
      const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 60_000);
      let response: Response;
      try { response = await fetch("/api/investigate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal }); }
      catch { if (controller.signal.aborted) throw new Error("Investigation timed out. You can retry intentionally."); throw new Error("Network error while investigating. Check your connection and retry."); }
      finally { window.clearTimeout(timeout); }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(explainError(response.status, body));
      if (!body || typeof body !== "object" || !("state" in body) || !["completed", "needs_review"].includes(String(body.state)) || !("evidence" in body) || !Array.isArray(body.evidence) || !("warnings" in body) || !Array.isArray(body.warnings)) throw new Error("Investigation returned malformed results. You can retry the request.");
      setStage("validating"); setProgress("Checking the result structure and evidence references…");
      const parsed = body as Result;
      if (parsed.state === "completed" && (!parsed.case || parsed.case.status !== "completed" || !Number.isFinite(parsed.case.totalPotentialOvercharge) || !Array.isArray(parsed.case.findings))) throw new Error("The completed response did not contain a valid case. Retry or review manually.");
      if (parsed.state === "needs_review" && parsed.case && parsed.case.status !== "needs_review") throw new Error("The review response contains an inconsistent case status. Retry or review manually.");
      const resultWithAudit = parsed.selfAudit?.length ? parsed : { ...parsed, selfAudit: [{ proposedFinding: "Potential invoice overcharge", checks: [{ name: "Challenge → Verify → Decide audit trail", result: "not_verified" as const, explanation: "This response did not include a structured audit record." }], supportingEvidence: [], contradictoryEvidence: [], disposition: "needs_review" as const, explanation: "No finding is promoted without the backend self-audit record." }] };
      setResult(resultWithAudit); setStage(parsed.state === "completed" ? "finished" : "review"); setProgress("");
    } catch (e) { const message = e instanceof Error ? e.message : "Unexpected error"; setError(message); setStage("error"); setProgress(""); }
  }

  async function loadDemo(name: string) {
    setDemoInfo(""); setError("");
    const scenarios: Record<string, { files: [Kind, string][]; ids: string[] }> = {
      overcharge: { files: [["contract", "contract.pdf"], ["purchase_order", "purchase-order.pdf"], ["invoice", "invoice.pdf"]], ids: ["C-001", "P-001", "I-001"] },
      review: { files: [["contract", "contract.pdf"], ["amendment", "amendment.pdf"], ["purchase_order", "purchase-order.pdf"], ["invoice", "invoice.pdf"]], ids: ["C-001", "A-001", "P-001", "I-001"] },
      revised: { files: [["contract", "contract.pdf"], ["amendment", "amendment.pdf"], ["purchase_order", "purchase-order-amended.pdf"], ["invoice", "invoice.pdf"]], ids: ["C-001", "A-001", "P-001", "I-001"] }
    };
    const scenario = scenarios[name]; const loaded: Doc[] = [];
    try {
      for (let i = 0; i < scenario.files.length; i++) {
        const [kind, filename] = scenario.files[i];
        const response = await fetch(`/fixtures/live-demo/${filename}`);
        if (!response.ok) throw new Error(`Could not load demonstration file ${filename}.`);
        const file = new File([await response.blob()], filename, { type: "application/pdf" });
        loaded.push({ key: `${kind}-${crypto.randomUUID()}`, kind, file, id: scenario.ids[i], progress: 0 });
      }
      setDocs(loaded); setResult(null); setStage("idle"); setDemoInfo("Local synthetic PDFs loaded. These are demonstration documents; results will be labeled only after an actual request to /api/investigate.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load the demonstration."); }
  }

  const addControl = (kind: Kind) => <label className="add-button" key={kind}>＋ Add {labels[kind].toLowerCase()}<input type="file" accept="application/pdf,.pdf" aria-label={`Add ${labels[kind]}`} onChange={(e: ChangeEvent<HTMLInputElement>) => { add(kind, e.target.files?.[0]); e.target.value = ""; }} /></label>;
  const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  return <main className="shell">
    <header className="topbar"><Link className="brand" href="/" aria-label="MarginGhost home"><span className="brand-icon">M</span><span>MarginGhost <small>V0.4</small></span></Link><nav className="main-nav" aria-label="Main navigation"><Link href="/">Overview</Link><a href="/investigate">Investigate</a><a href="/demo">Synthetic demo</a><Link href="/evaluation">Evaluation</Link>{result && <a href="#results">Results</a>}</nav><span className="mode-pill local-pill"><i/> Investigation workspace</span></header>
    {liveDisabled && <div className="deployment-note" role="status"><strong>Live AI investigation requires authorized access.</strong> Live extraction and investigation are disabled in this deployment. Your PDFs are not sent for processing here; use the synthetic demo to explore sample evidence.</div>}
    <section className="intro hero" id="top"><div className="eyebrow"><span className="dot"/> FINANCIAL CONTROL · INR</div><h1>Know what every invoice should cost.</h1><p>Compare supplier invoices with the contract and purchase order. Follow every discrepancy back to its source page.</p><a className="primary-button hero-action" href="#investigation">Start an investigation <span aria-hidden="true">↓</span></a><div className="hero-note">Evidence-led review <span>·</span> Human decision, always</div></section>
    <div className="workspace">
      <section className="card upload-card" id="investigation" aria-labelledby="upload-heading"><div className="section-head"><div><div className="step">01 / DOCUMENTS</div><h2 id="upload-heading">Build an investigation</h2></div><span className="quiet-pill">PDF · up to 10 MB each</span></div>
        <p className="section-copy">Add one contract, one purchase order and one or more invoices. Amendments are optional. Scanned PDFs without selectable text may need OCR before upload.</p>
        {(["contract", "purchase_order", "invoice", "amendment"] as Kind[]).map(kind => { const entries = docs.filter(d => d.kind === kind); const readyCount = entries.filter(d => d.id.trim() && d.file.size <= 10 * 1024 * 1024).length; return <section className={`doc-group doc-${kind}`} key={kind}><div className="group-title"><span className="doc-symbol" aria-hidden="true">{kind === "contract" ? "C" : kind === "purchase_order" ? "P" : kind === "invoice" ? "I" : "A"}</span><div className="doc-heading"><strong>{labels[kind]}{kind === "invoice" ? "s" : ""}</strong><small>{kind === "invoice" ? "Required · one or more" : kind === "amendment" ? "Optional · add any" : "Required · one"}</small></div><span className={`doc-count ${entries.length && readyCount === entries.length ? "is-ready" : ""}`}>{entries.length ? `${readyCount}/${entries.length} ready` : kind === "amendment" ? "Optional" : "Add document"}</span></div>{entries.map((doc, index) => <article className="file-row" key={doc.key}><div className="pdf-icon">PDF</div><div className="file-main"><div className="file-line"><strong title={doc.file.name}>{doc.file.name}</strong><span>{formatSize(doc.file.size)}</span></div><label className="id-label">Printed document ID <input value={doc.id} onChange={e => update(doc.key, { id: e.target.value })} placeholder="Enter ID shown inside the PDF" aria-label={`${labels[kind]} ${index + 1} printed document ID`} /></label><span className={`file-status ${doc.id.trim() ? "status-ready" : "status-pending"}`}>{doc.id.trim() ? "ID recorded" : "Printed ID required"}{doc.pages ? " · PDF extracted" : " · PDF pending"}</span>{doc.progress > 0 && <div className="progress-track" aria-label={`Upload progress ${doc.progress}%`}><span style={{ width: `${doc.progress}%` }}/></div>}{doc.error && <p className="inline-error">{doc.error}</p>}</div><div className="row-actions"><button type="button" className="text-action" onClick={() => inputRefs.current[doc.key]?.click()}>Replace</button><input ref={node => { inputRefs.current[doc.key] = node; }} className="hidden-file" type="file" accept="application/pdf,.pdf" aria-label={`Replace ${doc.file.name}`} onChange={e => { replace(doc.key, e.target.files?.[0]); e.target.value = ""; }}/><button type="button" className="text-action remove" onClick={() => remove(doc.key)} aria-label={`Remove ${doc.file.name}`}>Remove</button></div></article>)}{(kind === "invoice" || kind === "amendment" || entries.length === 0) && addControl(kind)}</section>; })}
        <div className="identity-note"><span className="note-mark">i</span><span>Use the printed ID inside each document. MarginGhost keeps it as the source reference and checks that extracted facts reconcile to it. File names are never used as financial facts.</span></div>
        {!uniqueIds && <div className="error-box" role="alert"><strong>Document IDs must be unique</strong><p>Two or more documents have the same printed ID. Check the IDs shown inside the PDFs.</p></div>}
        {error && <div className="error-box" role="alert"><strong>Could not complete investigation</strong><p>{error}</p>{stage === "error" && <button className="text-action" onClick={investigate}>Retry intentionally →</button>}</div>}
        {demoInfo && <div className="demo-banner" role="status">{demoInfo}</div>}
        <div className="submit-row"><button className="primary-button" disabled={liveDisabled || !ready || ["extracting", "investigating", "validating"].includes(stage)} onClick={investigate}>{["extracting", "investigating", "validating"].includes(stage) ? "Working…" : liveDisabled ? "Investigation unavailable" : "Investigate documents"}<span aria-hidden="true">→</span></button><span className="submit-hint">{liveDisabled ? "Uploads and live processing are disabled in this deployment." : "Your PDFs and extracted text stay in this browser session."}</span></div>
      </section>
      <aside className="side-column"><section className="card status-card"><div className="step">02 / INVESTIGATION</div><h2>Investigation status</h2><ol className="stage-list">{[["extracting", "Extracting PDFs"], ["investigating", "Investigating documents"], ["validating", "Validating evidence"], ["finished", "Completed"], ["review", "Needs review"]].map(([id, name]) => { const active = stage === id || (stage === "error" && id === "extracting"); const done = stage === "finished" || (stage === "review" && ["extracting", "investigating"].includes(id)) || (stage === "investigating" && id === "extracting") || (stage === "validating" && ["extracting", "investigating"].includes(id)); return <li key={id} className={`${active ? "active" : ""} ${done ? "done" : ""}`}><span className="stage-mark">{done ? "✓" : active ? <span className="spinner"/> : ""}</span>{name}{active && <small>{progress}</small>}</li>; })}</ol><div className="server-note">PDF extraction, fact matching and evidence checks are confirmed by the server response.</div></section>
        <section className="card demo-card" id="scenarios"><div className="step">LOCAL SYNTHETIC DOCUMENTS</div><h2>Load a sample case</h2><p>Load the bundled PDFs into the local workflow. Results only appear after you submit them for investigation.</p><div className="demo-actions"><button onClick={() => loadDemo("overcharge")}>Potential overcharge <span>₹18,000</span></button><button onClick={() => loadDemo("review")}>Amendment conflict <span>Review</span></button><button onClick={() => loadDemo("revised")}>Revised PO <span>₹0</span></button></div><div className="demo-foot">Local fixture files · no result is assumed in advance</div></section></aside>
    </div>
    {result && <section className="results" id="results" aria-live="polite"><div className="report-action"><button className="secondary-button" type="button" onClick={() => window.print()}>Print / Save report as PDF</button></div><ReportSection result={result} documents={docs} /><CaseEvaluationSummary audits={result.selfAudit ?? []} /><div className={`result-banner ${result.state === "needs_review" ? "review-banner" : "complete-banner"}`}><div><div className="step">INVESTIGATION RESULT</div><h2>{result.state === "needs_review" ? "Manual review needed" : "Investigation complete"}</h2><p>{result.state === "needs_review" ? (result.warnings[0] || "The documents could not be reconciled with enough confidence.") : result.case?.totalPotentialOvercharge === 0 ? "No potential overcharge was found in the invoices checked." : "Potential invoice overcharge identified. Review the cited source evidence before taking action."}</p></div><span className="status-chip">{result.state === "needs_review" ? "NEEDS REVIEW" : "COMPLETED"}</span></div>
      {result.state === "needs_review" && <div className="review-explainer"><strong>Do not treat this as a zero-overcharge result.</strong><span>The case could not be approved as a completed comparison. Resolve the warning or document identity issue and investigate again.</span></div>}
      {result.case && <><div className="metric-grid"><div className="metric-card metric-primary"><span>Potential overcharge</span><strong>{result.state === "needs_review" ? "Unresolved" : fmt(result.case.totalPotentialOvercharge)}</strong><small>{result.state === "needs_review" ? "No verified amount" : "Calculated from checked invoice lines"}</small></div><div className="metric-card"><span>Invoices reviewed</span><strong>{result.case.checkedInvoices}</strong><small>Unique invoice records in this case</small></div><div className="metric-card"><span>Findings</span><strong>{result.case.findings.length || (result.state === "needs_review" ? "—" : "None")}</strong><small>{result.state === "needs_review" ? "Review outcome unresolved" : "Potential discrepancies"}</small></div></div>
      <div className="card findings-card"><div className="section-head"><div><div className="step">LINE ITEM REVIEW</div><h2>Price comparisons</h2></div><span className="quiet-pill">All amounts INR</span></div>{result.case.findings.length === 0 && result.state === "completed" ? <div className="zero-findings"><span className="zero-check">✓</span><div><strong>No findings in checked lines</strong><p>The completed case found no potential overcharge for the supplied documents.</p></div></div> : result.case.findings.length === 0 ? <div className="review-empty"><strong>No verified comparison is available.</strong><span>Resolve the review notes before treating this case as a zero result.</span></div> : result.case.findings.map((f, i) => <article className="finding-row" key={`${f.invoiceId}-${f.sku}-${i}`}><div className="finding-head"><strong>{f.invoiceId} <span>·</span> {f.sku}</strong><span className={f.status === "needs_review" ? "finding-tag review-tag" : "finding-tag"}>{f.status === "needs_review" ? "REVIEW" : "POTENTIAL OVERCHARGE"}</span></div><p>{f.reason}</p><div className="comparison"><div><small>Contract unit price</small><strong>{f.expectedUnitPrice === undefined ? "Not established" : `${fmt(f.expectedUnitPrice)} / unit`}</strong></div><b aria-hidden="true">→</b><div><small>PO unit price</small><strong>{f.status === "potential_overcharge" && f.expectedUnitPrice !== undefined ? `${fmt(f.expectedUnitPrice)} / unit` : "Review source evidence"}</strong></div><b aria-hidden="true">→</b><div><small>Invoice unit price</small><strong>{fmt(f.billedUnitPrice)} / unit</strong></div><div><small>Quantity</small><strong>{f.quantity.toLocaleString("en-IN")}</strong></div><div className="line-total"><small>Potential line amount</small><strong>{f.potentialOvercharge === undefined ? "Review required" : fmt(f.potentialOvercharge)}</strong></div></div></article>)}</div></>}
      {(result.warnings.length > 0 || result.diagnostic) && <div className="warnings-box"><strong>Warnings and review notes</strong>{result.warnings.map((w, i) => <p key={i}>{w}</p>)}{result.diagnostic && <p>Diagnostic: {result.diagnostic.category}{result.diagnostic.status ? ` (HTTP ${result.diagnostic.status})` : ""}{result.diagnostic.providerCode ? ` · Provider code: ${result.diagnostic.providerCode}` : ""}{result.diagnostic.providerFailureStage ? ` · Provider phase: ${result.diagnostic.providerFailureStage.replaceAll("_", " ")}` : ""}{result.diagnostic.fields?.length ? ` · Fields: ${result.diagnostic.fields.join(", ")}` : ""}</p>}</div>}
      <section className="card evidence-card"><div className="evidence-toolbar"><div><div className="step">SOURCE DOCUMENTS</div><h2>Evidence explorer</h2><p>Exact excerpts from uploaded page text. Search finds text within source references and evidence.</p></div><label className="search-box"><span aria-hidden="true">⌕</span><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search evidence" aria-label="Search evidence"/></label></div>{filteredEvidence.length === 0 ? <p className="empty-evidence">No evidence matches this search. Try a document ID, field or phrase.</p> : <div className="evidence-list">{Object.entries(groupedEvidence).map(([sourceId, excerpts]) => <details id={`source-${encodeURIComponent(sourceId)}`} className="source-group" key={sourceId} open><summary><span className="source-doc-mark">PDF</span><span className="source-doc-title"><strong>{sourceId}</strong><small>{excerpts.length} verified {excerpts.length === 1 ? "excerpt" : "excerpts"}</small></span><span className="source-pages">{[...new Set(excerpts.map(e => e.page))].map(page => `Page ${page}`).join(" · ")}</span><span className="source-chevron" aria-hidden="true">⌄</span></summary><div className="source-excerpts">{excerpts.map((e, i) => <article className="evidence-item" key={`${e.page}-${e.field}-${i}`}><div className="evidence-meta"><span>PAGE {e.page}</span><span>{e.field.replaceAll(".", " / ").replaceAll("[", " ").replaceAll("]", "")}</span></div><blockquote>“{e.excerpt}”</blockquote></article>)}</div></details>)}</div>}</section>
      {result.selfAudit?.map((item, index) => <SelfAuditSection key={`live-audit-${index}`} audit={item} />)}
      <p className="disclaimer">Potential discrepancy only. MarginGhost does not approve a claim, contact suppliers or change payments.</p>
    </section>}
    <footer><span>MarginGhost <small>V0.4</small></span><span>Evidence first. Human reviewed.</span></footer>
  </main>;
}

export function SelfAuditSection({ audit, synthetic = false }: { audit: SelfAudit; synthetic?: boolean }) {
  const label = audit.disposition === "needs_review" ? "NEEDS REVIEW" : audit.disposition.toUpperCase();
  const supporting = [...new Map(audit.supportingEvidence.map(ref => [`${ref.sourceId}:${ref.page}`, ref])).values()];
  const contradictory = [...new Map(audit.contradictoryEvidence.map(ref => [`${ref.sourceId}:${ref.page}`, ref])).values()];
  return <section id={synthetic ? undefined : "self-audit"} className={`card self-audit-card audit-${audit.disposition}`} aria-label="Self-audit result">
    <div className="self-audit-heading"><div><div className="step">{synthetic ? "SELF-AUDIT · SYNTHETIC FIXTURE" : "CHALLENGE → VERIFY → DECIDE"}</div><h2>Investigation self-audit</h2></div><span className="self-audit-disposition">{label}</span></div>
    <p className="self-audit-proposal">{audit.proposedFinding}</p><p className="self-audit-explanation">{audit.explanation}</p>
    <ol className="self-audit-checks">{audit.checks.map(check => <li key={check.name}><span className={`check-status check-${check.result}`} aria-label={check.result}>{check.result === "passed" ? "✓" : check.result === "failed" ? "×" : "?"}</span><div><strong>{check.name}</strong><p>{check.explanation}</p></div><span className={`check-label check-${check.result}`}>{check.result === "not_verified" ? "UNKNOWN" : check.result.toUpperCase()}</span></li>)}</ol>
    {(audit.supportingEvidence.length > 0 || audit.contradictoryEvidence.length > 0) && <div className="self-audit-references">
      {supporting.length > 0 && <div><strong>Supporting references</strong><p>{supporting.map((e, i) => <span key={`${e.sourceId}-${e.page}`}><a href={`#source-${encodeURIComponent(e.sourceId)}`}>{e.sourceId} · p.{e.page}</a>{i < supporting.length - 1 ? "  ·  " : ""}</span>)}</p></div>}
      {contradictory.length > 0 && <div><strong>Contradictory references</strong><p>{contradictory.map((e, i) => <span key={`${e.sourceId}-${e.page}`}><a href={`#source-${encodeURIComponent(e.sourceId)}`}>{e.sourceId} · p.{e.page}</a>{i < contradictory.length - 1 ? "  ·  " : ""}</span>)}</p></div>}
    </div>}
    <div className="self-audit-disclaimer">This is an evidence review aid, not an approved payment claim. A person must review the cited documents before acting.</div>
  </section>;
}

function CaseEvaluationSummary({ audits }: { audits: SelfAudit[] }) {
  const summary = buildCaseEvaluation(audits);
  const attentionChecks = audits.flatMap(audit => audit.checks).filter(check => check.result === "failed" || check.result === "not_verified");
  const label = summary.disposition.replaceAll("_", " ").toUpperCase();
  return <section className={`card case-evaluation evaluation-${summary.disposition}`} aria-label="Live case evaluation">
    <div className="case-evaluation-heading"><div><div className="step">LIVE CASE EVALUATION</div><h2>Verification summary</h2></div><strong>{label}</strong></div>
    <p>Summary of self-audit checks performed for this investigation. This does not measure LLM extraction accuracy.</p>
    <dl className="evaluation-counts"><div><dt>Total checks</dt><dd>{summary.total}</dd></div><div><dt>Passed</dt><dd>{summary.passed}</dd></div><div className={summary.failed ? "count-alert" : ""}><dt>Failed</dt><dd>{summary.failed}</dd></div><div className={summary.unresolved || summary.unavailable ? "count-alert" : ""}><dt>Unresolved / unavailable</dt><dd>{summary.unavailable ? "Unavailable" : summary.unresolved}</dd></div></dl>
    {(summary.failed > 0 || summary.unresolved > 0 || summary.unavailable) && <div className="evaluation-alert">{summary.unavailable ? <p>No self-audit checks were supplied; this case needs review.</p> : <><p>{summary.failed} failed and {summary.unresolved} unresolved check{summary.unresolved === 1 ? "" : "s"}. Review these before acting.</p><ul>{attentionChecks.map((check, index) => <li key={`${check.name}-${index}`}><strong>{check.result === "failed" ? "FAILED" : "UNRESOLVED"}</strong> · {check.name}</li>)}</ul></>}</div>}
    <a href="#self-audit">View full verification trail <span aria-hidden="true">↘</span></a>
  </section>;
}

function ReportSection({ result, documents = [], synthetic = false }: { result: Result; documents?: Doc[]; synthetic?: boolean }) {
  const audits = result.selfAudit ?? [];
  const findings = result.case?.findings ?? [];
  const model = buildReportModel(result.state, findings, audits, result.evidence);
  const supported = model.disposition === "supported";
  const rejected = model.disposition === "rejected";
  const ids = [...new Set([...documents.map(d => d.id.trim()).filter(Boolean), ...result.evidence.map(e => e.sourceId)])];
  const overcharge = model.established;
  const fmtReport = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const label = result.state === "needs_review" ? "Needs human review" : supported ? "Potential overcharge supported" : rejected ? "Overcharge hypothesis rejected for checked lines" : "Completed; disposition unavailable";
  return <article className="investigation-report" aria-label="Investigation report">
    <header className="report-heading"><div><div className="step">MARGINGHOST · EVIDENCE FIRST</div><h2>{synthetic ? "Synthetic case report" : "Invoice investigation report"}</h2><p>{synthetic ? "Demonstration data only · Precomputed synthetic replay" : "Local live investigation · Human review required before action"}</p></div><span className="report-disposition">{label}</span></header>
    {synthetic && <p className="report-synthetic">SYNTHETIC DATA — This report describes a fixed demonstration scenario, not a real transaction or live AI investigation.</p>}
    <div className="report-meta"><div><strong>Case</strong><span>{ids.length ? ids.join(" · ") : "Identifiers unavailable"}</span></div><div><strong>Final disposition</strong><span>{label}</span></div><div><strong>Human review</strong><span>Required before any claim or payment action</span></div></div>
    <section><h3>Case evaluation · self-audit checks</h3><p>{model.evaluation.total} performed · {model.evaluation.passed} passed · {model.evaluation.failed} failed · {model.evaluation.unavailable ? "checks unavailable" : `${model.evaluation.unresolved} unresolved`} · {model.evaluation.disposition.replaceAll("_", " ").toUpperCase()}</p>{(model.evaluation.failed > 0 || model.evaluation.unresolved > 0 || model.evaluation.unavailable) && <p className="report-caution">{model.evaluation.unavailable ? "Checks were unavailable; manual review is required." : "Failed or unresolved checks require human review."}</p>}</section>
    <section><h3>Financial assessment</h3>{result.state === "needs_review" ? <p className="report-caution">Potential overcharge: <strong>Unresolved</strong>. No confirmed ₹0 result or claim amount was established.</p> : supported && overcharge.length ? <><p className="report-amount">Potential overcharge · {fmtReport(model.potentialOvercharge ?? 0)}</p>{overcharge.map((f, i) => <div className="report-comparison" key={`${f.invoiceId}-${f.sku}-${i}`}><strong>{f.invoiceId} · {f.sku}</strong><span>Agreed unit price {fmtReport(f.expectedUnitPrice!)} → invoice unit price {fmtReport(f.billedUnitPrice)}</span><span>Calculation: ({fmtReport(f.billedUnitPrice!)} − {fmtReport(f.expectedUnitPrice!)}) × {f.quantity.toLocaleString("en-IN")} = {fmtReport(Math.round((f.billedUnitPrice! - f.expectedUnitPrice!) * 100 * f.quantity) / 100)}</span><small>Deterministic amount from the reported line values; taxes and freight excluded where stated by the finding.</small></div>)}</> : rejected ? <p>No potential overcharge was established in the checked lines. This is not a universal assurance beyond the reviewed documents.</p> : <p>Not established. The response did not provide a supported financial finding.</p>}
    {findings.filter(f => f.status === "needs_review").map((f, i) => <p className="report-caution" key={`review-${i}`}>{f.invoiceId} · {f.sku}: {f.reason} Billed unit price {fmtReport(f.billedUnitPrice)}, quantity {f.quantity.toLocaleString("en-IN")}; governing unit price and amount unresolved.</p>)}</section>
    <section><h3>Self-audit</h3>{audits.length ? audits.map((audit, i) => <div className="report-audit" key={`audit-${i}`}><strong>{audit.disposition.replaceAll("_", " ").toUpperCase()} · {audit.proposedFinding}</strong><p>{audit.explanation}</p><ul>{audit.checks.map(check => <li key={check.name}><b>{check.result.replaceAll("_", " ").toUpperCase()}</b> — {check.name}: {check.explanation}</li>)}</ul></div>) : <p>Self-audit checks were not supplied; status is unknown.</p>}</section>
    {(result.warnings.length > 0 || !result.case) && <section><h3>Warnings and unresolved items</h3>{result.warnings.length ? <ul>{result.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul> : <p>Case details are unavailable.</p>}{result.diagnostic && <p>Diagnostic: {result.diagnostic.category}{result.diagnostic.fields?.length ? ` · ${result.diagnostic.fields.join(", ")}` : ""}</p>}</section>}
    <section><h3>Source documents and cited excerpts</h3>{model.citations.length ? <div className="report-evidence">{model.citations.map((e, i) => <blockquote key={`${e.sourceId}-${e.page}-${e.field}-${i}`}><strong>{e.sourceId} · page {e.page} · {e.field}</strong><span>“{e.excerpt}”</span></blockquote>)}</div> : <p>No verified source excerpts are available in this response.</p>}
    {model.contradictions.length > 0 && <div className="report-contradictions"><strong>Contradictory evidence flagged by self-audit</strong>{model.contradictions.map((ref, i) => <blockquote key={i}>{ref.sourceId} · page {ref.page}: “{ref.excerpt}”</blockquote>)}</div>}</section>
    <footer className="report-footer">MarginGhost is an evidence review aid. A qualified person must review source documents and unresolved items before taking action. This report is not an approved claim, accounting advice, supplier communication, or payment instruction.</footer>
  </article>;
}
