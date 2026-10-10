"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";

type Kind = "contract" | "purchase_order" | "invoice" | "amendment";
type Doc = { key: string; kind: Kind; file: File; id: string; pages?: { page: number; text: string }[]; progress: number; error?: string };
type Finding = { invoiceId: string; sku: string; status: "potential_overcharge" | "needs_review"; expectedUnitPrice?: number; billedUnitPrice: number; quantity: number; potentialOvercharge?: number; reason: string; evidence: string[] };
type Case = { status: "completed" | "needs_review"; currency: "INR"; totalPotentialOvercharge: number; findings: Finding[]; checkedInvoices: number; warnings: string[] };
type Evidence = { field: string; sourceId: string; page: number; excerpt: string };
type Result = { state: "completed" | "needs_review"; case: Case | null; evidence: Evidence[]; warnings: string[]; diagnostic?: { category: string; fields?: string[]; status?: number } };
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

export default function Home() {
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
  const ready = docs.length >= 3 && docs.length <= 25 && docs.some(d => d.kind === "contract") && docs.some(d => d.kind === "purchase_order") && sumInvoices > 0 && uniqueIds && docs.every(d => d.id.trim() && d.id.trim().length <= 100 && d.file.size <= 10 * 1024 * 1024);

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
      setResult(parsed); setStage(parsed.state === "completed" ? "finished" : "review"); setProgress("");
    } catch (e) { const message = e instanceof Error ? e.message : "Unexpected error"; setError(message); setStage("error"); setProgress(""); }
  }

  async function loadDemo(name: string) {
    setDemoInfo(""); setError("");
    const scenarios: Record<string, { files: [Kind, string][]; ids: string[] }> = {
      overcharge: { files: [["contract", "contract.pdf"], ["purchase_order", "purchase-order.pdf"], ["invoice", "invoice.pdf"]], ids: ["C-001", "PO-017", "INV-104"] },
      review: { files: [["contract", "contract.pdf"], ["amendment", "amendment.pdf"], ["purchase_order", "purchase-order.pdf"], ["invoice", "invoice.pdf"]], ids: ["C-001", "AM-001", "PO-017", "INV-104"] },
      revised: { files: [["contract", "contract.pdf"], ["amendment", "amendment.pdf"], ["purchase_order", "purchase-order-amended.pdf"], ["invoice", "invoice.pdf"]], ids: ["C-001", "AM-001", "PO-018", "INV-104"] }
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
    <header className="topbar"><a className="brand" href="#top" aria-label="MarginGhost home"><span className="brand-icon">M</span><span>MarginGhost <small>V0.4</small></span></a><div className="top-note">SUPPLIER INVOICE INVESTIGATION</div></header>
    {process.env.NODE_ENV !== "development" && <div className="deployment-note" role="status"><strong>Live investigation unavailable in this deployment.</strong> Live model calls are restricted to local development.</div>}
    <section className="intro" id="top"><div className="eyebrow"><span className="dot"/> EVIDENCE FIRST · INR</div><h1>Find the money hidden in supplier invoices.</h1><p>Compare supplier invoices with the agreed contract and purchase order. Every finding links back to the source page that supports it.</p></section>
    <div className="workspace">
      <section className="card upload-card" aria-labelledby="upload-heading"><div className="section-head"><div><div className="step">01 / DOCUMENTS</div><h2 id="upload-heading">Build an investigation</h2></div><span className="quiet-pill">PDF · up to 10 MB each</span></div>
        <p className="section-copy">Add one contract, one purchase order and one or more invoices. Amendments are optional. Scanned PDFs without selectable text may need OCR before upload.</p>
        {(["contract", "purchase_order", "invoice", "amendment"] as Kind[]).map(kind => { const entries = docs.filter(d => d.kind === kind); return <div className="doc-group" key={kind}><div className="group-title"><strong>{labels[kind]}{kind === "invoice" ? "s" : ""}</strong><span>{kind === "invoice" ? "Required · one or more" : kind === "amendment" ? "Optional · add any" : "Required · one"}</span></div>{entries.map((doc, index) => <article className="file-row" key={doc.key}><div className="pdf-icon">PDF</div><div className="file-main"><div className="file-line"><strong title={doc.file.name}>{doc.file.name}</strong><span>{formatSize(doc.file.size)}</span></div><label className="id-label">Printed document ID <input value={doc.id} onChange={e => update(doc.key, { id: e.target.value })} placeholder="Enter ID shown inside the PDF" aria-label={`${labels[kind]} ${index + 1} printed document ID`} /></label>{doc.progress > 0 && <div className="progress-track" aria-label={`Upload progress ${doc.progress}%`}><span style={{ width: `${doc.progress}%` }}/></div>}{doc.error && <p className="inline-error">{doc.error}</p>}</div><div className="row-actions"><button type="button" className="text-action" onClick={() => inputRefs.current[doc.key]?.click()}>Replace</button><input ref={node => { inputRefs.current[doc.key] = node; }} className="hidden-file" type="file" accept="application/pdf,.pdf" aria-label={`Replace ${doc.file.name}`} onChange={e => { replace(doc.key, e.target.files?.[0]); e.target.value = ""; }}/><button type="button" className="text-action remove" onClick={() => remove(doc.key)} aria-label={`Remove ${doc.file.name}`}>Remove</button></div></article>)}{(kind === "invoice" || kind === "amendment" || entries.length === 0) && addControl(kind)}</div>; })}
        <div className="identity-note"><span className="note-mark">i</span><span>Use the printed ID inside each document. MarginGhost keeps it as the source reference and checks that extracted facts reconcile to it. File names are never used as financial facts.</span></div>
        {!uniqueIds && <div className="error-box" role="alert"><strong>Document IDs must be unique</strong><p>Two or more documents have the same printed ID. Check the IDs shown inside the PDFs.</p></div>}
        {error && <div className="error-box" role="alert"><strong>Could not complete investigation</strong><p>{error}</p>{stage === "error" && <button className="text-action" onClick={investigate}>Retry intentionally →</button>}</div>}
        {demoInfo && <div className="demo-banner" role="status">{demoInfo}</div>}
        <div className="submit-row"><button className="primary-button" disabled={!ready || ["extracting", "investigating", "validating"].includes(stage)} onClick={investigate}>{["extracting", "investigating", "validating"].includes(stage) ? "Working…" : "Investigate documents"}<span aria-hidden="true">→</span></button><span className="submit-hint">Your PDFs and extracted text stay in this browser session.</span></div>
      </section>
      <aside className="side-column"><section className="card status-card"><div className="step">02 / INVESTIGATION</div><h2>Progress</h2><ol className="stage-list">{[["extracting", "Extracting PDFs"], ["investigating", "Investigating documents"], ["validating", "Validating evidence"], ["finished", "Finished"], ["review", "Needs review"]].map(([id, name]) => { const active = stage === id || (stage === "error" && id === "extracting"); const done = stage === "finished" || (stage === "review" && ["extracting", "investigating"].includes(id)) || (stage === "investigating" && id === "extracting") || (stage === "validating" && ["extracting", "investigating"].includes(id)); return <li key={id} className={`${active ? "active" : ""} ${done ? "done" : ""}`}><span className="stage-mark">{done ? "✓" : active ? <span className="spinner"/> : ""}</span>{name}{active && <small>{progress}</small>}</li>; })}</ol><div className="server-note">Steps appear as the server responds. Extraction and evidence checks are not assumed complete in advance.</div></section>
        <section className="card demo-card"><div className="step">LOCAL SYNTHETIC DEMONSTRATION</div><h2>Try a sample case</h2><p>Load provided synthetic PDFs. An investigation result is produced only if you submit them to the API.</p><div className="demo-actions"><button onClick={() => loadDemo("overcharge")}>Overcharge</button><button onClick={() => loadDemo("review")}>Needs review</button><button onClick={() => loadDemo("revised")}>Revised PO · zero</button></div><div className="demo-foot">No model claim is made until an actual request returns.</div></section></aside>
    </div>
    {result && <section className="results" aria-live="polite"><div className={`result-banner ${result.state === "needs_review" ? "review-banner" : "complete-banner"}`}><div><div className="step">INVESTIGATION RESULT</div><h2>{result.state === "needs_review" ? "Manual review needed" : "Investigation complete"}</h2><p>{result.state === "needs_review" ? (result.warnings[0] || "The documents could not be reconciled with enough confidence.") : result.case?.totalPotentialOvercharge === 0 ? "No potential overcharge was found in the invoices checked." : "Potential invoice overcharge identified. Review the cited source evidence before taking action."}</p></div><span className="status-chip">{result.state === "needs_review" ? "NEEDS REVIEW" : "COMPLETED"}</span></div>
      {result.state === "needs_review" && <div className="review-explainer"><strong>Do not treat this as a zero-overcharge result.</strong><span>The case could not be approved as a completed comparison. Resolve the warning or document identity issue and investigate again.</span></div>}
      {result.case && <><div className="metric-grid"><div className="metric-card"><span>Potential overcharge</span><strong>{fmt(result.case.totalPotentialOvercharge)}</strong><small>Calculated from checked invoice lines</small></div><div className="metric-card"><span>Invoices checked</span><strong>{result.case.checkedInvoices}</strong><small>Unique invoice records in this case</small></div><div className="metric-card"><span>Findings</span><strong>{result.case.findings.length}</strong><small>Potential discrepancies requiring review</small></div></div>
      <div className="card findings-card"><div className="section-head"><div><div className="step">LINE ITEM REVIEW</div><h2>Price comparisons</h2></div><span className="quiet-pill">All amounts INR</span></div>{result.case.findings.length === 0 ? <div className="zero-findings"><span className="zero-check">✓</span><div><strong>No findings in checked lines</strong><p>The completed case found no potential overcharge for the supplied documents.</p></div></div> : result.case.findings.map((f, i) => <article className="finding-row" key={`${f.invoiceId}-${f.sku}-${i}`}><div className="finding-head"><strong>{f.invoiceId} <span>·</span> {f.sku}</strong><span className={f.status === "needs_review" ? "finding-tag review-tag" : "finding-tag"}>{f.status === "needs_review" ? "REVIEW" : "POTENTIAL OVERCHARGE"}</span></div><p>{f.reason}</p><div className="comparison"><div><small>Contract unit price</small><strong>{f.expectedUnitPrice === undefined ? "Not established" : `${fmt(f.expectedUnitPrice)} / unit`}</strong></div><b aria-hidden="true">→</b><div><small>PO unit price</small><strong>{f.status === "potential_overcharge" && f.expectedUnitPrice !== undefined ? `${fmt(f.expectedUnitPrice)} / unit` : "Review source evidence"}</strong></div><b aria-hidden="true">→</b><div><small>Invoice unit price</small><strong>{fmt(f.billedUnitPrice)} / unit</strong></div><div><small>Quantity</small><strong>{f.quantity.toLocaleString("en-IN")}</strong></div><div className="line-total"><small>Potential line amount</small><strong>{f.potentialOvercharge === undefined ? "Review required" : fmt(f.potentialOvercharge)}</strong></div></div></article>)}</div></>}
      {(result.warnings.length > 0 || result.diagnostic) && <div className="warnings-box"><strong>Warnings and review notes</strong>{result.warnings.map((w, i) => <p key={i}>{w}</p>)}{result.diagnostic && <p>Diagnostic: {result.diagnostic.category}{result.diagnostic.status ? ` (HTTP ${result.diagnostic.status})` : ""}{result.diagnostic.fields?.length ? ` · Fields: ${result.diagnostic.fields.join(", ")}` : ""}</p>}</div>}
      <section className="card evidence-card"><div className="section-head"><div><div className="step">SOURCE TRAIL</div><h2>Evidence</h2><p>Exact excerpts from uploaded page text. Evidence is shown as source material, not generated proof.</p></div><label className="search-box"><span>⌕</span><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter evidence" aria-label="Filter evidence"/></label></div>{filteredEvidence.length === 0 ? <p className="empty-evidence">No evidence matches this filter.</p> : <div className="evidence-list">{filteredEvidence.map((e, i) => <article className="evidence-item" key={`${e.sourceId}-${e.page}-${e.field}-${i}`}><div className="evidence-meta"><span className="source-id">{e.sourceId}</span><span>PAGE {e.page}</span><span>{e.field.replaceAll(".", " / ").replaceAll("[", " ").replaceAll("]", "")}</span></div><blockquote>“{e.excerpt}”</blockquote></article>)}</div>}</section>
      <p className="disclaimer">Potential discrepancy only. MarginGhost does not approve a claim, contact suppliers or change payments.</p>
    </section>}
    <footer><span>MarginGhost <small>V0.4</small></span><span>Evidence first. Human reviewed.</span></footer>
  </main>;
}
