import HomeClient from "../home-client";
import { isDemoMode } from "@/lib/demo-mode";
import { cookies } from "next/headers";
import { previewConfig, sessionTokenFromCookieHeader, verifySession } from "@/lib/judge-preview";
import JudgePreviewClient from "../judge-preview/judge-preview-client";

export const dynamic = "force-dynamic";
export default async function InvestigatePage() {
  if (process.env.NODE_ENV === "production") {
    const config = previewConfig();
    if (!config || isDemoMode()) return <JudgePreviewClient disabled={!config} />;
    const jar = await cookies();
    if (!verifySession(jar.get("mg_judge_session")?.value ?? sessionTokenFromCookieHeader(jar.toString()), config.sessionSecret)) return <JudgePreviewClient />;
    return <HomeClient demoMode={false} judgePreview />;
  }
  return <HomeClient demoMode={false} liveDisabled={isDemoMode()} />;
}
