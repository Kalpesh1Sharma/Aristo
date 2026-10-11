import { NextResponse } from "next/server";
import { clearCookieHeader, previewConfig, requestHasSameOrigin } from "@/lib/judge-preview";
import { boundedBodyError, readBoundedBody } from "@/lib/bounded-request-body";
export async function POST(request: Request) {
  const config = previewConfig();
  if (!config || !requestHasSameOrigin(request)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  const bounded = await readBoundedBody(request, 0);
  if (!bounded.ok) return boundedBodyError(bounded.reason, 0);
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", clearCookieHeader());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
