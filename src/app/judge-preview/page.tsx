import JudgePreviewClient from "./judge-preview-client";
import { previewEnabled } from "@/lib/judge-preview";
export const dynamic = "force-dynamic";
export default function JudgePreviewPage() { return <JudgePreviewClient disabled={!previewEnabled()} />; }
