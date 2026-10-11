import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
// Loading the worker entry as a normal module registers WorkerMessageHandler on
// globalThis. Node PDF.js uses that handler directly instead of a web Worker.
import "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { resolve, sep } from "node:path";

/** PDF text extraction only. Extracted text is untrusted and must be reviewed/mapped
 * into the existing JSON schema before it can enter the deterministic audit flow.
 */
export type PdfPageText = { page: number; text: string };

export type PdfIngestionFailureCategory =
  | "pdfjs_assets_unavailable"
  | "pdf_worker_unavailable"
  | "pdf_document_unreadable"
  | "pdf_text_extraction_failed";
const PDF_FAILURE_CATEGORIES = new Set<PdfIngestionFailureCategory>([
  "pdfjs_assets_unavailable",
  "pdf_worker_unavailable",
  "pdf_document_unreadable",
  "pdf_text_extraction_failed",
]);

/** Carries only a safe category; parser messages can contain implementation details. */
export class PdfIngestionFailure extends Error {
  constructor(readonly category: PdfIngestionFailureCategory) {
    super("PDF processing failed");
    this.name = "PdfIngestionFailure";
  }
}

/** Accept safe category metadata across duplicate module instances in test/build runtimes. */
export function getPdfIngestionFailureCategory(error: unknown): PdfIngestionFailureCategory | null {
  if (!error || typeof error !== "object" || !("category" in error)) return null;
  const category = error.category;
  return typeof category === "string" && PDF_FAILURE_CATEGORIES.has(category as PdfIngestionFailureCategory)
    ? category as PdfIngestionFailureCategory
    : null;
}

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 250;

export async function extractPdfPages(input: Uint8Array): Promise<PdfPageText[]> {
  if (input.byteLength === 0) throw new Error("PDF is empty");
  if (input.byteLength > MAX_PDF_BYTES) throw new Error("PDF exceeds the 10MB limit");
  if (new TextDecoder().decode(input.subarray(0, 5)) !== "%PDF-") {
    throw new Error("Uploaded file is not a PDF");
  }

  let standardFontDataUrl: string;
  let cMapUrl: string;
  try {
    // Keep the runtime asset paths independent of Next's transformed ESM module
    // URL. The route's tracing includes retain these package data directories.
    const pdfjsRoot = resolve(process.cwd(), "node_modules/pdfjs-dist");
    standardFontDataUrl = `${resolve(pdfjsRoot, "standard_fonts")}${sep}`;
    cMapUrl = `${resolve(pdfjsRoot, "cmaps")}${sep}`;
  } catch {
    throw new PdfIngestionFailure("pdfjs_assets_unavailable");
  }

  let loadingTask: ReturnType<typeof pdfjs.getDocument>;
  try {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(input),
      standardFontDataUrl,
      cMapUrl,
      cMapPacked: true,
      useWorkerFetch: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    throw new PdfIngestionFailure(message.includes("worker") ? "pdf_worker_unavailable" : "pdf_document_unreadable");
  }
  let document: Awaited<typeof loadingTask.promise>;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    await loadingTask.destroy().catch(() => undefined);
    throw new PdfIngestionFailure(message.includes("worker") ? "pdf_worker_unavailable" : "pdf_document_unreadable");
  }
  if (document.numPages > MAX_PDF_PAGES) {
    await loadingTask.destroy();
    throw new Error("PDF exceeds the 250 page limit");
  }
  const pages: PdfPageText[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .filter((item): item is typeof item & { str: string } => "str" in item)
        .map(item => item.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push({ page: pageNumber, text });
      page.cleanup();
    }
  } catch {
    throw new PdfIngestionFailure("pdf_text_extraction_failed");
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
  return pages;
}
