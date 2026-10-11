import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const SESSION_SECONDS = 60 * 60;
const COOKIE = "mg_judge_session";

export type PreviewConfig = { passwordHash: string; sessionSecret: string; redisUrl: string; redisToken: string; enabled: true };
function validPasswordVerifier(value: string) {
  const parts = value.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "base64url"); const hash = Buffer.from(parts[2], "base64url");
    return salt.length === 18 && hash.length === 64 && salt.toString("base64url") === parts[1] && hash.toString("base64url") === parts[2];
  } catch { return false; }
}
export function previewConfig(): PreviewConfig | null {
  const passwordHash = process.env.JUDGE_PREVIEW_PASSWORD_HASH || "";
  const sessionSecret = process.env.JUDGE_PREVIEW_SESSION_SECRET || "";
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL || "";
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || "";
  const dailyLimit = Number(process.env.JUDGE_PREVIEW_DAILY_LIMIT || 30);
  let redisHost = "";
  try { const url = new URL(redisUrl); redisHost = url.hostname; if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password || url.port) return null; } catch { return null; }
  if (process.env.JUDGE_PREVIEW_ENABLED !== "true" || process.env.DEMO_MODE !== "false" || process.env.LLM_MODE !== "groq_free" || !/^gsk_[A-Za-z0-9_-]{20,}$/.test(process.env.LLM_API_KEY || "") || process.env.LLM_PAID_FALLBACK !== "false" || (process.env.LLM_API_URL && process.env.LLM_API_URL !== "https://api.groq.com/openai/v1/chat/completions") || (process.env.LLM_MODEL && process.env.LLM_MODEL !== "openai/gpt-oss-20b") || !Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000 || !validPasswordVerifier(passwordHash) || sessionSecret.length < 32 || sessionSecret.trim() !== sessionSecret || !/^[a-z0-9.-]+\.upstash\.io$/i.test(redisHost) || redisToken.length < 32 || redisToken.trim() !== redisToken) return null;
  return { passwordHash, sessionSecret, redisUrl, redisToken, enabled: true };
}
export function previewEnabled() { return previewConfig() !== null; }

export async function verifyPassword(password: string, verifier: string) {
  const [scheme, salt, expected] = verifier.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  try {
    const actual = await scrypt(password, Buffer.from(salt, "base64url"), 64) as Buffer;
    const expectedBytes = Buffer.from(expected, "base64url");
    return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
  } catch { return false; }
}
export async function makePasswordVerifier(password: string) {
  const salt = randomBytes(18);
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}
function signature(value: string, secret: string) { return createHmac("sha256", secret).update(value).digest("base64url"); }
export function issueSession(secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_SECONDS, nonce: randomBytes(16).toString("base64url") })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}
export function verifySession(token: string | null, secret: string, now = Date.now()) {
  if (!token || token.length > 512) return false;
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra) return false;
  const expected = Buffer.from(signature(payload, secret)); const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  try { const session = JSON.parse(Buffer.from(payload, "base64url").toString()); return Number.isInteger(session.exp) && session.exp > Math.floor(now / 1000) && typeof session.nonce === "string"; } catch { return false; }
}
export function sessionTokenFromCookieHeader(header: string | null) { return (header || "").split(";").map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? null; }
export function cookieHeader(token: string, maxAge = SESSION_SECONDS) { return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`; }
export function clearCookieHeader() { return cookieHeader("", 0); }
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    if (originUrl.username || originUrl.password || originUrl.pathname !== "/" || originUrl.search || originUrl.hash) return false;
    if (process.env.NODE_ENV === "production") {
      const host = request.headers.get("host");
      if (!host || originUrl.protocol !== "https:") return false;
      return originUrl.host === new URL(`https://${host}`).host;
    }
    return originUrl.origin === new URL(request.url).origin;
  } catch { return false; }
}
export function requestHasSameOrigin(request: Request) { return sameOrigin(request); }
export function validSession(request: Request, config: PreviewConfig) { return sameOrigin(request) && verifySession(sessionTokenFromCookieHeader(request.headers.get("cookie")), config.sessionSecret); }
export function clientKey(request: Request, config: PreviewConfig) {
  // Vercel overwrites this platform header with the connecting client IP.
  // Never fall back to caller-controlled X-Forwarded-For or X-Real-IP values.
  const ip = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (!ip && process.env.NODE_ENV === "production") throw new Error("trusted_client_ip_unavailable");
  return createHmac("sha256", config.sessionSecret).update(ip || "unknown").digest("hex");
}

// Lua script atomically checks and increments one or more fixed-window counters.
const LIMIT_SCRIPT = `local n=#KEYS; for i=1,n do local limit=tonumber(ARGV[i]); local c=tonumber(redis.call('GET',KEYS[i]) or '0'); if c>=limit then return 0 end end; for i=1,n do local ttl=tonumber(ARGV[n+i]); local c=redis.call('INCR',KEYS[i]); if c==1 then redis.call('EXPIRE',KEYS[i],ttl) end end; return 1`;
export async function reserveLimits(config: PreviewConfig, limits: { key: string; limit: number; windowSeconds: number }[]) {
  if (!limits.length) return false;
  const keys = limits.map(x => `mg:limit:${x.key}:${Math.floor(Date.now() / (x.windowSeconds * 1000))}`);
  const args = [...limits.map(x => String(x.limit)), ...limits.map(x => String(x.windowSeconds + 5))];
  const response = await fetch(config.redisUrl, { method: "POST", headers: { Authorization: `Bearer ${config.redisToken}`, "Content-Type": "application/json" }, body: JSON.stringify(["EVAL", LIMIT_SCRIPT, String(keys.length), ...keys, ...args]), cache: "no-store", signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("quota_store_unavailable");
  const result = await response.json() as { result?: number };
  if (result.result !== 0 && result.result !== 1) throw new Error("quota_store_unavailable");
  return result.result === 1;
}

export async function reserveLogin(config: PreviewConfig, client: string) {
  return reserveLimits(config, [
    { key: `auth-global:${Math.floor(Date.now() / 60000)}`, limit: 120, windowSeconds: 60 },
    { key: `auth-client:${client}:${Math.floor(Date.now() / 900000)}`, limit: 8, windowSeconds: 900 }
  ]);
}
export async function reserveUpload(config: PreviewConfig, client: string) {
  return reserveLimits(config, [
    { key: `upload-global:${Math.floor(Date.now() / 3600000)}`, limit: 100, windowSeconds: 3600 },
    { key: `upload-client:${client}:${Math.floor(Date.now() / 3600000)}`, limit: 20, windowSeconds: 3600 }
  ]);
}
export async function reserveAudit(config: PreviewConfig, client: string) {
  return reserveLimits(config, [
    { key: `audit-global:${Math.floor(Date.now() / 3600000)}`, limit: 120, windowSeconds: 3600 },
    { key: `audit-client:${client}:${Math.floor(Date.now() / 3600000)}`, limit: 30, windowSeconds: 3600 }
  ]);
}
export async function reserveInvestigation(config: PreviewConfig, client: string) {
  return reserveLimits(config, [
    { key: `invest-global:${Math.floor(Date.now() / 86400000)}`, limit: Number(process.env.JUDGE_PREVIEW_DAILY_LIMIT || 30), windowSeconds: 86400 },
    { key: `invest-client:${client}:${Math.floor(Date.now() / 3600000)}`, limit: 5, windowSeconds: 3600 }
  ]);
}

export function safeAuthError() { return Response.json({ error: "Judge preview unavailable or access denied" }, { status: 403 }); }
export function authorizeSession(request: Request) {
  const config = previewConfig();
  if (process.env.NODE_ENV !== "production" && !config) return { local: true } as const;
  if (!config || !validSession(request, config)) return { response: safeAuthError() } as const;
  return { config, preview: true } as const;
}
export async function reserveProcessing(request: Request, session: { local: true } | { config: PreviewConfig; preview: true }, kind: "upload" | "investigation" | "audit") {
  if ("local" in session) return {} as const;
  try {
    const client = clientKey(request, session.config);
    const allowed = kind === "upload" ? await reserveUpload(session.config, client) : kind === "audit" ? await reserveAudit(session.config, client) : await reserveInvestigation(session.config, client);
    return allowed ? {} as const : { response: Response.json({ error: "Judge preview usage limit reached" }, { status: 429 }) } as const;
  } catch {
    return { response: safeAuthError() } as const;
  }
}
