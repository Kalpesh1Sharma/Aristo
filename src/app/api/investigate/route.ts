import { NextResponse } from "next/server";
import { z } from "zod";
import { investigate } from "@/lib/investigation";
import { ensureTracing, flushTracing, tracedWorkflow } from "@/lib/observability";

export const runtime = "nodejs";
export async function POST(request: Request) {
  let tracing = false;
  try {
    if (Number(request.headers.get("content-length") || 0) > 1024 * 1024) return NextResponse.json({ error: "Payload too large; 1MB maximum" }, { status: 413 });
    tracing = await ensureTracing();
    const payload = await request.json();
    const result = await tracedWorkflow(() => investigate(payload));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid investigation input", issues: error.issues }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Investigation failed" }, { status: 422 });
  } finally {
    try { await flushTracing(tracing); } catch { /* tracing must not affect the audit response */ }
  }
}
