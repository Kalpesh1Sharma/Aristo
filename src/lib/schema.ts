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

// Every model-extracted fact is independently tied to a quote on an uploaded page.
export const sourceDocumentSchema = z.object({ id: itemId, type: z.enum(["contract", "purchase_order", "invoice", "amendment"]), pages: z.array(z.object({ page: z.number().int().positive(), text: z.string().max(100_000) })).min(1) }).strict();
export const evidenceFactSchema = <T extends z.ZodType>(value: T) => z.object({ value, sourceId: itemId, page: z.number().int().positive(), excerpt: z.string().min(1).max(1000) }).strict();
const fact = evidenceFactSchema;
const extractedItemSchema = z.object({ sku: fact(itemId), quantity: fact(quantity), unitPrice: fact(money) }).strict();
const extractedDocumentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("contract"), id: fact(itemId), supplierId: fact(itemId), currency: fact(currency), validFrom: fact(date), validTo: fact(date).optional(), prices: z.array(z.object({ sku: fact(itemId), unitPrice: fact(money) }).strict()).min(1) }).strict(),
  z.object({ type: z.literal("amendment"), id: fact(itemId), supplierId: fact(itemId), contractId: fact(itemId), currency: fact(currency), effectiveFrom: fact(date), effectiveTo: fact(date).optional(), prices: z.array(z.object({ sku: fact(itemId), unitPrice: fact(money) }).strict()).min(1) }).strict(),
  z.object({ type: z.literal("purchase_order"), id: fact(itemId), supplierId: fact(itemId), contractId: fact(itemId), currency: fact(currency), orderedAt: fact(date), items: z.array(extractedItemSchema).min(1) }).strict(),
  z.object({ type: z.literal("invoice"), id: fact(itemId), supplierId: fact(itemId), purchaseOrderId: fact(itemId), currency: fact(currency), issuedAt: fact(date), items: z.array(extractedItemSchema).min(1) }).strict()
]);
export const extractedFactsSchema = z.object({ documents: z.array(extractedDocumentSchema).min(3).max(25) }).strict();
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export type ExtractedFacts = z.infer<typeof extractedFactsSchema>;
