import { NextResponse } from "next/server";
import { z } from "zod";
import { auditInputSchema } from "@/lib/schema";
import { auditDocuments } from "@/lib/audit";
import { ensureTracing, tracedParse, tracedAudit, tracedWorkflow, flushTracing } from "@/lib/observability";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let tracing = false;
  try {
    if (Number(request.headers.get("content-length") || 0) > 1024 * 1024) {
      return NextResponse.json({ error: "Payload too large; 1MB maximum" }, { status: 413 });
    }
    tracing = await ensureTracing();
    const payload = await request.json();
    const result = await tracedWorkflow(async () => {
      const validated = await tracedParse(() => auditInputSchema.parse(payload));
      return tracedAudit(() => auditDocuments(validated));
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid document schema", issues: error.issues }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Audit failed" }, { status: 422 });
  } finally {
    try { await flushTracing(tracing); } catch (e) { console.error("Trace flush failed", e); }
  }
}
