/** PDF text extraction only. Extracted text is untrusted and must be reviewed/mapped
 * into the existing JSON schema before it can enter the deterministic audit flow.
 */
export type PdfPageText = { page: number; text: string };

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 250;

export async function extractPdfPages(input: Uint8Array): Promise<PdfPageText[]> {
  if (input.byteLength === 0) throw new Error("PDF is empty");
  if (input.byteLength > MAX_PDF_BYTES) throw new Error("PDF exceeds the 10MB limit");
  if (new TextDecoder().decode(input.subarray(0, 5)) !== "%PDF-") {
    throw new Error("Uploaded file is not a PDF");
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(input) });
  const document = await loadingTask.promise;
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
  } finally {
    await loadingTask.destroy();
  }
  return pages;
}
