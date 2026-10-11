export type ReportFinding = { invoiceId: string; sku: string; reason: string; status: "potential_overcharge" | "needs_review"; expectedUnitPrice?: number; billedUnitPrice: number; quantity: number; potentialOvercharge?: number };
export type ReportAudit = { disposition: "supported" | "rejected" | "needs_review"; contradictoryEvidence: { sourceId: string; page: number; excerpt: string }[]; checks?: EvaluationCheck[] };
export type EvaluationCheck = { result: "passed" | "failed" | "not_verified" };
export type EvaluationAudit = { disposition: ReportAudit["disposition"]; checks?: EvaluationCheck[] };
export function buildCaseEvaluation(audits: EvaluationAudit[]) {
  const checks = audits.flatMap(audit => audit.checks ?? []);
  const passed = checks.filter(check => check.result === "passed").length;
  const failed = checks.filter(check => check.result === "failed").length;
  const unresolved = checks.filter(check => check.result === "not_verified").length;
  const unavailable = checks.length === 0;
  const disposition = unavailable || unresolved > 0 || audits.some(audit => audit.disposition === "needs_review")
    ? "needs_review" as const
    : failed > 0 ? "rejected" as const
    : audits.some(audit => audit.disposition === "supported") ? "supported" as const
    : "rejected" as const;
  return { total: checks.length, passed, failed, unresolved, unavailable, disposition };
}
export type ReportEvidence = { field: string; sourceId: string; page: number; excerpt: string };
export function buildReportModel(state: "completed" | "needs_review", findings: ReportFinding[], audits: ReportAudit[], evidence: ReportEvidence[]) {
  const evaluation = buildCaseEvaluation(audits);
  const disposition = state === "needs_review" || evaluation.disposition === "needs_review" ? "needs_review" : evaluation.disposition;
  const established = disposition === "supported" ? findings.filter(f => f.status === "potential_overcharge" && f.expectedUnitPrice !== undefined && f.potentialOvercharge !== undefined && f.billedUnitPrice > f.expectedUnitPrice && f.quantity > 0) : [];
  const citations = evidence.filter(ref => ref.sourceId && Number.isInteger(ref.page) && ref.page > 0 && ref.excerpt.length > 0);
  const contradictions = audits.flatMap(a => a.contradictoryEvidence).filter((ref, i, refs) => citations.some(c => c.sourceId === ref.sourceId && c.page === ref.page && c.excerpt === ref.excerpt) && refs.findIndex(x => x.sourceId === ref.sourceId && x.page === ref.page && x.excerpt === ref.excerpt) === i);
  const lineAmount = (finding: ReportFinding) => Math.round((finding.billedUnitPrice - finding.expectedUnitPrice!) * 100 * finding.quantity) / 100;
  return { disposition, established, potentialOvercharge: established.length ? established.reduce((sum, f) => sum + lineAmount(f), 0) : null, citations, contradictions, evaluation };
}
