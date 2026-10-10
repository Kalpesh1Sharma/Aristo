import assert from "node:assert/strict";
import test from "node:test";
import { extractPdfPages } from "../src/lib/pdf-ingestion";

test("rejects empty and non-PDF uploads before parsing", async () => {
  await assert.rejects(() => extractPdfPages(new Uint8Array()), /empty/);
  await assert.rejects(() => extractPdfPages(new TextEncoder().encode("not a PDF")), /not a PDF/);
});

test("rejects oversized PDF data before parsing", async () => {
  await assert.rejects(() => extractPdfPages(new Uint8Array(10 * 1024 * 1024 + 1)), /10MB/);
});
