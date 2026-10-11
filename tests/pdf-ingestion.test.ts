import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractPdfPages } from "../src/lib/pdf-ingestion";
import { readBoundedBody } from "../src/lib/bounded-request-body";
import { POST as ingestPdf } from "../src/app/api/ingest/pdf/route";

test("rejects empty and non-PDF uploads before parsing", async () => {
  await assert.rejects(() => extractPdfPages(new Uint8Array()), /empty/);
  await assert.rejects(() => extractPdfPages(new TextEncoder().encode("not a PDF")), /not a PDF/);
});

test("rejects oversized PDF data before parsing", async () => {
  await assert.rejects(() => extractPdfPages(new Uint8Array(10 * 1024 * 1024 + 1)), /10MB/);
});

test("bounded multipart parsing preserves bundled PDF bytes and the ingestion route extracts its text", async () => {
  const pdfBytes = new Uint8Array(await readFile(new URL("../fixtures/live-demo/contract.pdf", import.meta.url)));
  const makeRequest = () => {
    const form = new FormData();
    form.set("file", new File([pdfBytes], "contract.pdf", { type: "application/pdf" }));
    return new Request("http://localhost/api/ingest/pdf", { method: "POST", body: form });
  };

  // Exercise the route's exact bounded-body/FormData reconstruction steps and
  // verify that parsing the reconstructed multipart body is byte-for-byte exact.
  const multipartRequest = makeRequest();
  const bounded = await readBoundedBody(multipartRequest, 10 * 1024 * 1024 + 64 * 1024);
  assert.equal(bounded.ok, true);
  if (!bounded.ok) return;
  const reconstructedRequest = new Request(multipartRequest.url, {
    method: "POST",
    headers: { "Content-Type": multipartRequest.headers.get("content-type")! },
    body: new Uint8Array(bounded.bytes),
  });
  const reconstructedFile = (await reconstructedRequest.formData()).get("file");
  assert.ok(reconstructedFile instanceof File);
  assert.deepEqual(new Uint8Array(await reconstructedFile.arrayBuffer()), pdfBytes);

  const env = process.env as Record<string, string | undefined>;
  const previous = { nodeEnv: env.NODE_ENV, demoMode: env.DEMO_MODE, previewEnabled: env.JUDGE_PREVIEW_ENABLED };
  env.NODE_ENV = "test";
  env.DEMO_MODE = "false";
  delete env.JUDGE_PREVIEW_ENABLED;
  try {
    const response = await ingestPdf(makeRequest());
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const result = JSON.parse(responseText) as { pages: { page: number; text: string }[] };
    assert.equal(result.pages.length, 1);
    assert.equal(result.pages[0]?.page, 1);
    assert.ok(result.pages[0]?.text.includes("Contract C-001"), "expected text from the synthetic contract PDF");
  } finally {
    if (previous.nodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = previous.nodeEnv;
    if (previous.demoMode === undefined) delete env.DEMO_MODE; else env.DEMO_MODE = previous.demoMode;
    if (previous.previewEnabled === undefined) delete env.JUDGE_PREVIEW_ENABLED; else env.JUDGE_PREVIEW_ENABLED = previous.previewEnabled;
  }
});
