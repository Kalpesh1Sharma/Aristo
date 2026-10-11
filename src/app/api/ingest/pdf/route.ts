import { NextResponse } from "next/server";
import { extractPdfPages } from "@/lib/pdf-ingestion";
import { isDemoMode } from "@/lib/demo-mode";
import { authorizeSession, reserveProcessing } from "@/lib/judge-preview";
import { boundedBodyError, readBoundedBody } from "@/lib/bounded-request-body";

export const runtime = "nodejs";
const MAX_PDF_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  if (isDemoMode()) return NextResponse.json({ error: "PDF ingestion is disabled in synthetic demo mode" }, { status: 403 });
  const session = authorizeSession(request);
  if (session.response) return session.response;
  const bounded = await readBoundedBody(request, MAX_PDF_BYTES + 64 * 1024);
  if (!bounded.ok) return boundedBodyError(bounded.reason, MAX_PDF_BYTES + 64 * 1024);
  const access = await reserveProcessing(request, session, "upload");
  if (access.response) return access.response;
  try {
    const contentType = request.headers.get("content-type");
    if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) return NextResponse.json({ error: "Upload a PDF multipart request" }, { status: 400 });
    const multipartBytes = new Uint8Array(bounded.bytes.byteLength);
    multipartBytes.set(bounded.bytes);
    const boundedRequest = new Request(request.url, { method: "POST", headers: { "Content-Type": contentType }, body: multipartBytes });
    const form = await boundedRequest.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload a PDF in the 'file' field" }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "PDF exceeds the 10MB limit" }, { status: 413 });
    }
    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ error: "File must have PDF content type" }, { status: 415 });
    }
    const pages = await extractPdfPages(new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ pages });
  } catch (error) {
  const message =
    error instanceof Error ? error.message : "PDF ingestion failed";

  const clientError = /empty|limit|not a PDF/i.test(message);
  const safeMessage = /empty/i.test(message) ? "PDF is empty" : /limit/i.test(message) ? "PDF exceeds the configured size or page limit" : /not a PDF/i.test(message) ? "Uploaded file is not a PDF" : "PDF could not be read";

  return NextResponse.json(
    { error: safeMessage },
    { status: clientError ? 400 : 422 }
  );
  }
}
