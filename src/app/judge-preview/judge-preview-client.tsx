"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import Navigation from "../navigation";

export default function JudgePreviewClient({ disabled = false }: { disabled?: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/judge-preview/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (!response.ok) throw new Error(response.status === 429 ? "Too many attempts. Try again later." : "Sign-in failed or preview access is unavailable.");
      setSignedIn(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed."); setPassword(""); }
    finally { setBusy(false); }
  }
  if (disabled) return <main className="shell"><Navigation /><section className="card judge-panel"><div className="step">JUDGE PREVIEW</div><h1>Preview access is unavailable</h1><p>Judge preview is disabled or its security configuration is incomplete. Public synthetic examples remain available.</p><Link className="secondary-button" href="/demo">Open synthetic demo →</Link></section></main>;
  return <main className="shell"><Navigation /><section className="card judge-panel"><div className="step">INVITED JUDGES</div><h1>Sign in to Judge Preview</h1><p>Use the preview password provided to invited neatHack judges.</p><div role="note" className="deployment-note"><strong>Hackathon preview only.</strong> Do not upload confidential, personal, or real customer financial information. Uploaded documents are processed for this session and must be synthetic or approved for demonstration use.</div><form onSubmit={login} className="judge-form">{signedIn ? <><p role="status">You are signed in.</p><Link className="primary-button" href="/investigate">Continue to investigations →</Link></> : <><label htmlFor="judge-password">Preview password</label><input id="judge-password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /><button className="primary-button" disabled={busy || disabled}>{busy ? "Signing in…" : "Sign in"}</button>{error && <p role="alert">{error}</p>}</>}</form></section></main>;
}
