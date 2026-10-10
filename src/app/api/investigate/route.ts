import { NextResponse } from "next/server";
import { z } from "zod";
import { investigate } from "@/lib/investigation";
import { isDemoMode } from "@/lib/demo-mode";
import { ensureTracing, flushTracing, tracedWorkflow } from "@/lib/observability";

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
export async function POST(request: Request) {
  let tracing = false;
  try {
    if (isDemoMode()) return NextResponse.json({ error: "Live investigation is disabled in synthetic demo mode" }, { status: 403 });
    if (Number(request.headers.get("content-length") || 0) > 1024 * 1024) return NextResponse.json({ error: "Payload too large; 1MB maximum" }, { status: 413 });
    const mode = process.env.LLM_MODE || "offline";
    if (mode !== "offline" && mode !== "groq_free") return NextResponse.json({ error: "Invalid investigation mode" }, { status: 503 });
    if (mode === "groq_free" && !isLocalDevelopmentRequest(request)) {
      devDiagnostic("local_request_rejected");
      return NextResponse.json({ error: "Live extraction is restricted to local development", ...(process.env.NODE_ENV === "development" ? { diagnostic: { category: "local_request_rejected" } } : {}) }, { status: 403 });
    }
    // Offline requests never initialize a network-backed telemetry client.
    if (mode === "groq_free") tracing = await ensureTracing();
    const payload = await request.json();
    const result = await tracedWorkflow(() => investigate(payload));
    if (result.diagnostic) devDiagnostic(result.diagnostic.category, {
      ...(result.diagnostic.status ? { status: result.diagnostic.status } : {}),
      ...(result.diagnostic.fields ? { fields: result.diagnostic.fields } : {}),
      ...(result.diagnostic.providerCode ? { providerCode: result.diagnostic.providerCode } : {}),
      ...(result.diagnostic.providerType ? { providerType: result.diagnostic.providerType } : {}),
      ...(result.diagnostic.param ? { param: result.diagnostic.param } : {}),
      ...(result.diagnostic.providerKeyword ? { providerKeyword: result.diagnostic.providerKeyword } : {})
    });
    if (process.env.NODE_ENV !== "development" && "diagnostic" in result) {
      const safeResult = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "diagnostic"));
      return NextResponse.json(safeResult);
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid investigation input", issues: error.issues }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Investigation failed" }, { status: 422 });
  } finally {
    try { await flushTracing(tracing); } catch { /* tracing must not affect the audit response */ }
  }
}
