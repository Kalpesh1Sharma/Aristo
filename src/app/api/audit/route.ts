import { NextResponse } from "next/server";
import { z } from "zod";
import { auditInputSchema } from "@/lib/schema";
import { auditDocuments } from "@/lib/audit";
import { isDemoMode } from "@/lib/demo-mode";
import { ensureTracing, tracedParse, tracedAudit, tracedWorkflow, flushTracing } from "@/lib/observability";
import { authorizeSession, reserveProcessing } from "@/lib/judge-preview";
import { boundedBodyError, readBoundedBody } from "@/lib/bounded-request-body";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  let tracing = false;
  try {
    if (isDemoMode()) return NextResponse.json({ error: "Audit API is disabled in synthetic demo mode" }, { status: 403 });
    const session = authorizeSession(request);
    if (session.response) return session.response;
    const bounded = await readBoundedBody(request, 1024 * 1024);
    if (!bounded.ok) return boundedBodyError(bounded.reason, 1024 * 1024);
    const access = await reserveProcessing(request, session, "audit");
    if (access.response) return access.response;
    tracing = await ensureTracing();
    const payload = JSON.parse(new TextDecoder().decode(bounded.bytes));
    const result = await tracedWorkflow(async () => {
      const validated = await tracedParse(() => auditInputSchema.parse(payload));
      return tracedAudit(() => auditDocuments(validated));
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid document schema", issues: error.issues.map(issue => ({ path: issue.path, code: issue.code })) }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    return NextResponse.json({ error: "Audit failed" }, { status: 422 });
  } finally {
    try { await flushTracing(tracing); } catch { /* tracing must not expose request data or affect response */ }
  }
}
