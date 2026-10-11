import { NextResponse } from "next/server";
import { z } from "zod";
import { investigate } from "@/lib/investigation";
import { isDemoMode } from "@/lib/demo-mode";
import { ensureTracing, flushTracing, tracedWorkflow } from "@/lib/observability";
import { authorizeSession, reserveProcessing } from "@/lib/judge-preview";
import { boundedBodyError, readBoundedBody } from "@/lib/bounded-request-body";

export const runtime = "nodejs";
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
function devDiagnostic(category: string, details: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "development") console.warn("[MarginGhost diagnostic]", { category, ...details });
}
function isLocalDevelopmentRequest(request: Request) {
  if (process.env.NODE_ENV !== "development") return false;
  let host = "";
  try { host = new URL(`http://${request.headers.get("host")}`).hostname.toLowerCase(); } catch { return false; }
  if (!host || !localHosts.has(host)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return localHosts.has(new URL(origin).hostname.toLowerCase()); } catch { return false; }
}
export async function POST(request: Request): Promise<Response> {
  let tracing = false;
  try {
    if (isDemoMode()) return NextResponse.json({ error: "Live investigation is disabled in synthetic demo mode" }, { status: 403 });
    const session = authorizeSession(request);
    if (session.response) return session.response;
    const bounded = await readBoundedBody(request, 1024 * 1024);
    if (!bounded.ok) return boundedBodyError(bounded.reason, 1024 * 1024);
    const mode = process.env.LLM_MODE || "offline";
    if (mode !== "offline" && mode !== "groq_free") return NextResponse.json({ error: "Invalid investigation mode" }, { status: 503 });
    if (mode === "groq_free" && !isLocalDevelopmentRequest(request) && !("preview" in session && session.preview)) {
      devDiagnostic("local_request_rejected");
      return NextResponse.json({ error: "Live extraction is restricted to local development", ...(process.env.NODE_ENV === "development" ? { diagnostic: { category: "local_request_rejected" } } : {}) }, { status: 403 });
    }
    const payload = JSON.parse(new TextDecoder().decode(bounded.bytes));
    if (!payload || !Array.isArray(payload.documents) || payload.documents.length < 3 || payload.documents.length > 25) return NextResponse.json({ error: "Invalid document count" }, { status: 400 });
    if (payload.documents.some((document: unknown) => !document || typeof document !== "object" || !Array.isArray((document as { pages?: unknown }).pages) || ((document as { pages: unknown[] }).pages).length < 1 || ((document as { pages: unknown[] }).pages).length > 250)) return NextResponse.json({ error: "Each document must contain between 1 and 250 pages" }, { status: 400 });
    const access = await reserveProcessing(request, session, "investigation");
    if (access.response) return access.response;
    // Offline requests never initialize a network-backed telemetry client.
    if (mode === "groq_free") tracing = await ensureTracing();
    const result = await tracedWorkflow(() => investigate(payload));
    if (result.diagnostic) devDiagnostic(result.diagnostic.category, {
      ...(result.diagnostic.status ? { status: result.diagnostic.status } : {}),
      ...(result.diagnostic.fields ? { fields: result.diagnostic.fields } : {}),
      ...(result.diagnostic.structuralFailures ? { structuralFailures: result.diagnostic.structuralFailures } : {}),
      ...(result.diagnostic.providerCode ? { providerCode: result.diagnostic.providerCode } : {}),
      ...(result.diagnostic.providerType ? { providerType: result.diagnostic.providerType } : {}),
      ...(result.diagnostic.param ? { param: result.diagnostic.param } : {}),
      ...(result.diagnostic.providerKeyword ? { providerKeyword: result.diagnostic.providerKeyword } : {}),
      ...(result.diagnostic.providerFailureStage ? { providerFailureStage: result.diagnostic.providerFailureStage } : {})
    });
    if (process.env.NODE_ENV !== "development" && "diagnostic" in result) {
      const safeResult = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "diagnostic"));
      return NextResponse.json(safeResult);
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid investigation input", issues: error.issues.map(issue => ({ path: issue.path, code: issue.code })) }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    return NextResponse.json({ error: "Investigation failed; manual review is required" }, { status: 422 });
  } finally {
    try { await flushTracing(tracing); } catch { /* tracing must not affect the audit response */ }
  }
}
