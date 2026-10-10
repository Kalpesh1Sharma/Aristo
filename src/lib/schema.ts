import { z } from "zod";

const itemId = z.string().min(1).max(100);
const money = z.number().finite().nonnegative();
const quantity = z.number().finite().positive();
const currency = z.literal("INR");
const date = z.iso.date();

export const contractSchema = z.object({
  type: z.literal("contract"), id: itemId, supplierId: itemId,
  currency, validFrom: date, validTo: date.optional(),
  prices: z.array(z.object({ sku: itemId, unitPrice: money })).min(1),
  evidence: z.string().min(1)
}).strict();
export const purchaseOrderSchema = z.object({
  type: z.literal("purchase_order"), id: itemId, supplierId: itemId,
  contractId: itemId, currency, orderedAt: date,
  items: z.array(z.object({ sku: itemId, quantity, unitPrice: money })).min(1)
}).strict();
export const invoiceSchema = z.object({
  type: z.literal("invoice"), id: itemId, supplierId: itemId,
  purchaseOrderId: itemId, currency, issuedAt: date,
  items: z.array(z.object({ sku: itemId, quantity, unitPrice: money })).min(1)
}).strict();
export const auditInputSchema = z.object({
  contract: contractSchema,
  purchaseOrder: purchaseOrderSchema,
  invoices: z.array(invoiceSchema).min(1).max(25)
}).strict();
export type AuditInput = z.infer<typeof auditInputSchema>;
export type Finding = {
  invoiceId: string; sku: string; status: "potential_overcharge" | "needs_review";
  expectedUnitPrice?: number; billedUnitPrice: number; quantity: number;
  potentialOvercharge?: number; reason: string; evidence: string[];
};
export type AuditResult = { status: "completed" | "needs_review"; currency: "INR"; totalPotentialOvercharge: number; findings: Finding[]; checkedInvoices: number; warnings: string[] };
