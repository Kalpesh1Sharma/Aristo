import { NextResponse } from "next/server";
import { clientKey, cookieHeader, previewConfig, requestHasSameOrigin, reserveLogin, safeAuthError, verifyPassword, issueSession } from "@/lib/judge-preview";
import { boundedBodyError, readBoundedBody } from "@/lib/bounded-request-body";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const config = previewConfig();
  if (!config || !requestHasSameOrigin(request)) return safeAuthError();
  const bounded = await readBoundedBody(request, 2048);
  if (!bounded.ok) return boundedBodyError(bounded.reason, 2048);
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bounded.bytes)); } catch { return NextResponse.json({ error: "Invalid sign-in request" }, { status: 400 }); }
  if (!body || typeof body !== "object" || typeof (body as { password?: unknown }).password !== "string" || (body as { password: string }).password.length > 256) return NextResponse.json({ error: "Invalid sign-in request" }, { status: 400 });
  try {
    if (!await reserveLogin(config, clientKey(request, config))) return NextResponse.json({ error: "Too many sign-in attempts. Try again later." }, { status: 429 });
    if (!await verifyPassword((body as { password: string }).password, config.passwordHash)) return safeAuthError();
    const response = NextResponse.json({ ok: true });
    response.headers.set("Set-Cookie", cookieHeader(issueSession(config.sessionSecret)));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch { return safeAuthError(); }
}
