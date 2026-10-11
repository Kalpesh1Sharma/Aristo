"use client";
import { useRouter } from "next/navigation";

export default function JudgeLogoutButton() {
  const router = useRouter();
  return <button type="button" className="text-action" onClick={async () => { await fetch("/api/judge-preview/logout", { method: "POST" }); router.push("/judge-preview"); }}>Sign out</button>;
}
