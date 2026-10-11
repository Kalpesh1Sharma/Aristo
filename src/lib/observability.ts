import { init, flush, span } from "neatlogs";
let initialization: Promise<void> | undefined;
export async function ensureTracing() {
  if (!process.env.NEATLOGS_API_KEY) return false;
  initialization ??= init({ apiKey: process.env.NEATLOGS_API_KEY, workflowName: "supplier-invoice-audit" });
  await initialization;
  return true;
}
// Privacy: capture neither inputs nor outputs (supplier financial information).
export const tracedParse = span({ kind: "TOOL", name: "validate_supplier_documents", captureInput: false, captureOutput: false }, async <T>(fn: () => T) => fn());
export const tracedAudit = span({ kind: "CHAIN", name: "compare_contract_and_invoice", captureInput: false, captureOutput: false }, async <T>(fn: () => T) => fn());
export const tracedWorkflow = span({ kind: "WORKFLOW", name: "supplier_invoice_audit", captureInput: false, captureOutput: false }, async <T>(fn: () => Promise<T>) => fn());
export const tracedExtraction = span({ kind: "TOOL", name: "document_extraction", captureInput: false, captureOutput: false }, async <T>(fn: () => Promise<T>) => fn());
export const tracedMatching = span({ kind: "CHAIN", name: "document_matching", captureInput: false, captureOutput: false }, async <T>(fn: () => Promise<T>) => fn());
export const tracedInvestigation = span({ kind: "CHAIN", name: "amendment_investigation", captureInput: false, captureOutput: false }, async <T>(fn: () => Promise<T>) => fn());
export const tracedVerification = span({ kind: "CHAIN", name: "evidence_verification", captureInput: false, captureOutput: false }, async <T>(fn: () => Promise<T>) => fn());
export const tracedChallenge = span({ kind: "CHAIN", name: "challenge_candidate_finding", captureInput: false, captureOutput: false }, async <T>(fn: () => T) => fn());
export const tracedDecision = span({ kind: "CHAIN", name: "deterministic_finding_decision", captureInput: false, captureOutput: false }, async <T>(fn: () => T) => fn());
export const tracedRetry = span({ kind: "TOOL", name: "bounded_extraction_retry", captureInput: false, captureOutput: false }, async <T>(fn: () => Promise<T>) => fn());
export async function flushTracing(enabled: boolean) { if (enabled) await flush(); }
