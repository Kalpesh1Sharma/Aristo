import { NextResponse } from "next/server";
import { previewConfig, sessionTokenFromCookieHeader, verifySession } from "@/lib/judge-preview";
export async function GET(request: Request) {
  const config = previewConfig();
  if (!config) return NextResponse.json({ authenticated: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const authenticated = verifySession(sessionTokenFromCookieHeader(request.headers.get("cookie")), config.sessionSecret);
  return NextResponse.json({ authenticated }, { headers: { "Cache-Control": "no-store" } });
}
