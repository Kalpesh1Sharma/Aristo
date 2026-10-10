import { auditInputSchema, type AuditInput, type AuditResult, type Finding } from "./schema";

// Money is calculated in integer paise to avoid floating point accumulation.
const paise = (n: number) => Math.round(n * 100);
const rupees = (n: number) => Number((n / 100).toFixed(2));
const uniqueBySku = <T extends { sku: string }>(xs: T[]) => new Map(xs.map(x => [x.sku, x]));
const hasRepeatedSku = <T extends { sku: string }>(xs: T[]) => new Set(xs.map(x => x.sku)).size !== xs.length;

export function auditDocuments(untrusted: unknown): AuditResult {
  const data: AuditInput = auditInputSchema.parse(untrusted);
  const { contract, purchaseOrder: po, invoices } = data;
  const warnings: string[] = [];
  const findings: Finding[] = [];
  let totalPaise = 0;

  if (contract.supplierId !== po.supplierId || contract.id !== po.contractId) {
    throw new Error("Contract and purchase order do not match");
  }
  if (hasRepeatedSku(contract.prices) || hasRepeatedSku(po.items)) {
    throw new Error("Repeated SKU in contract or purchase order; manual review required");
  }
  const contractPrices = uniqueBySku(contract.prices);
  const poPrices = uniqueBySku(po.items);
  const seenInvoices = new Set<string>();

  for (const invoice of invoices) {
    if (invoice.supplierId !== contract.supplierId || invoice.purchaseOrderId !== po.id) {
      warnings.push(`${invoice.id}: supplier or PO mismatch; not audited`);
      continue;
    }
    if (seenInvoices.has(invoice.id)) {
      warnings.push(`${invoice.id}: duplicate invoice ID in upload; requires human review`);
      continue;
    }
    seenInvoices.add(invoice.id);
    if (hasRepeatedSku(invoice.items)) {
      warnings.push(`${invoice.id}: repeated SKU lines; requires human review`);
      continue;
    }
    if (invoice.issuedAt < contract.validFrom || (contract.validTo && invoice.issuedAt > contract.validTo)) {
      warnings.push(`${invoice.id}: invoice date outside contract validity; requires amendment review`);
      continue;
    }
    for (const line of invoice.items) {
      const contracted = contractPrices.get(line.sku);
      const ordered = poPrices.get(line.sku);
      const evidence = [`Contract ${contract.id}: ${contract.evidence}`, `Purchase order ${po.id}`, `Invoice ${invoice.id}: item ${line.sku}`];
      if (!contracted || !ordered) {
        findings.push({ invoiceId: invoice.id, sku: line.sku, status: "needs_review", billedUnitPrice: line.unitPrice, quantity: line.quantity, reason: "No matching SKU in both contract and PO", evidence });
        continue;
      }
      if (paise(ordered.unitPrice) !== paise(contracted.unitPrice) || line.quantity > ordered.quantity) {
        findings.push({ invoiceId: invoice.id, sku: line.sku, status: "needs_review", billedUnitPrice: line.unitPrice, quantity: line.quantity, reason: "PO price differs from contract or billed quantity exceeds ordered quantity", evidence });
        continue;
      }
      const delta = paise(line.unitPrice) - paise(contracted.unitPrice);
      if (delta > 0) {
        // Assumes quantity is integral or a quantity where multiplication remains in paise.
        const overcharge = Math.round(delta * line.quantity);
        totalPaise += overcharge;
        findings.push({ invoiceId: invoice.id, sku: line.sku, status: "potential_overcharge", expectedUnitPrice: contracted.unitPrice, billedUnitPrice: line.unitPrice, quantity: line.quantity, potentialOvercharge: rupees(overcharge), reason: "Billed unit price exceeds valid agreed unit price (tax/freight excluded)", evidence });
      }
    }
  }
  return { status: warnings.length || findings.some(f => f.status === "needs_review") ? "needs_review" : "completed", currency: "INR", totalPotentialOvercharge: rupees(totalPaise), findings, checkedInvoices: seenInvoices.size, warnings };
}
