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
export async function flushTracing(enabled: boolean) { if (enabled) await flush(); }
