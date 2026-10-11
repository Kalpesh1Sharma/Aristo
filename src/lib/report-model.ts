export type ReportFinding = { invoiceId: string; sku: string; reason: string; status: "potential_overcharge" | "needs_review"; expectedUnitPrice?: number; billedUnitPrice: number; quantity: number; potentialOvercharge?: number };
export type ReportAudit = { disposition: "supported" | "rejected" | "needs_review"; contradictoryEvidence: { sourceId: string; page: number; excerpt: string }[] };
export type ReportEvidence = { field: string; sourceId: string; page: number; excerpt: string };
export function buildReportModel(state: "completed" | "needs_review", findings: ReportFinding[], audits: ReportAudit[], evidence: ReportEvidence[]) {
  const disposition = state === "needs_review" || audits.some(a => a.disposition === "needs_review") ? "needs_review" : audits.some(a => a.disposition === "supported") ? "supported" : audits.some(a => a.disposition === "rejected") ? "rejected" : "unknown";
  const established = disposition === "supported" ? findings.filter(f => f.status === "potential_overcharge" && f.expectedUnitPrice !== undefined && f.potentialOvercharge !== undefined && f.billedUnitPrice > f.expectedUnitPrice && f.quantity > 0) : [];
  const citations = evidence.filter(ref => ref.sourceId && Number.isInteger(ref.page) && ref.page > 0 && ref.excerpt.length > 0);
  const contradictions = audits.flatMap(a => a.contradictoryEvidence).filter((ref, i, refs) => citations.some(c => c.sourceId === ref.sourceId && c.page === ref.page && c.excerpt === ref.excerpt) && refs.findIndex(x => x.sourceId === ref.sourceId && x.page === ref.page && x.excerpt === ref.excerpt) === i);
  const lineAmount = (finding: ReportFinding) => Math.round((finding.billedUnitPrice - finding.expectedUnitPrice!) * 100 * finding.quantity) / 100;
  return { disposition, established, potentialOvercharge: established.length ? established.reduce((sum, f) => sum + lineAmount(f), 0) : null, citations, contradictions };
}
