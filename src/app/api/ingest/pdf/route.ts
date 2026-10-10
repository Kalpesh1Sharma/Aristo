import { NextResponse } from "next/server";
import { extractPdfPages } from "@/lib/pdf-ingestion";
import { isDemoMode } from "@/lib/demo-mode";

export const runtime = "nodejs";
const MAX_PDF_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  if (isDemoMode()) return NextResponse.json({ error: "PDF ingestion is disabled in synthetic demo mode" }, { status: 403 });
  try {
    const form = await request.formData();
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

  if (process.env.NODE_ENV === "development") {
    console.error("[PDF DEBUG]", {
      name: error instanceof Error ? error.name : typeof error,
      message,
    });
  }

  const clientError = /empty|limit|not a PDF/i.test(message);

  return NextResponse.json(
    { error: clientError ? message : "PDF could not be read" },
    { status: clientError ? 400 : 422 }
  );
  }
}
