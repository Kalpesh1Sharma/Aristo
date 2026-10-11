import assert from "node:assert/strict";
import test from "node:test";
import { POST as loginPost } from "../src/app/api/judge-preview/login/route";
import { POST as investigatePost } from "../src/app/api/investigate/route";
import { POST as ingestPost } from "../src/app/api/ingest/pdf/route";
import { POST as auditPost } from "../src/app/api/audit/route";
import { GET as sessionGet } from "../src/app/api/judge-preview/session/route";
import { POST as logoutPost } from "../src/app/api/judge-preview/logout/route";
import { makePasswordVerifier, issueSession, verifySession, clientKey, previewConfig, requestHasSameOrigin } from "../src/lib/judge-preview";
import Home from "../src/app/page";
import DemoPage from "../src/app/demo/page";
import EvaluationPage from "../src/app/evaluation/page";

const env = process.env as Record<string, string | undefined>;
const keys = ["NODE_ENV", "DEMO_MODE", "JUDGE_PREVIEW_ENABLED", "JUDGE_PREVIEW_PASSWORD_HASH", "JUDGE_PREVIEW_SESSION_SECRET", "JUDGE_PREVIEW_DAILY_LIMIT", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "LLM_MODE", "LLM_API_KEY", "LLM_API_URL", "LLM_MODEL", "LLM_PAID_FALLBACK"];
const saved: Record<string, string | undefined> = {};
let priorFetch: typeof fetch;
const testPassword = "judges-only-preview-password-unique";
const sessionSecret = "test-session-key-that-is-long-enough-for-hmac";
async function configure() {
  Object.assign(env, { NODE_ENV: "production", DEMO_MODE: "false", JUDGE_PREVIEW_ENABLED: "true", JUDGE_PREVIEW_PASSWORD_HASH: await makePasswordVerifier(testPassword), JUDGE_PREVIEW_SESSION_SECRET: sessionSecret, JUDGE_PREVIEW_DAILY_LIMIT: "10", UPSTASH_REDIS_REST_URL: "https://test.upstash.io", UPSTASH_REDIS_REST_TOKEN: "test-redis-token-which-is-long-enough", LLM_MODE: "groq_free", LLM_API_KEY: "gsk_test-provider-key-which-is-long-enough", LLM_API_URL: "https://api.groq.com/openai/v1/chat/completions", LLM_MODEL: "openai/gpt-oss-20b", LLM_PAID_FALLBACK: "false" });
}
function installRedis(result: number | "fail" = 1) {
  globalThis.fetch = (async () => result === "fail" ? new Response("", { status: 503 }) : Response.json({ result })) as typeof fetch;
}
async function setup() { for (const key of keys) saved[key] = env[key]; priorFetch = globalThis.fetch; await configure(); installRedis(); }
function restore() { for (const key of keys) { if (saved[key] === undefined) delete env[key]; else env[key] = saved[key]; } globalThis.fetch = priorFetch; }
const req = (url: string, body: unknown, cookie = "", extraHeaders: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { Host: new URL(url).host, Origin: new URL(url).origin, "x-vercel-forwarded-for": "192.0.2.9", "Content-Type": "application/json", "Content-Length": String(JSON.stringify(body).length), ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders }, body: JSON.stringify(body) });

test("judge login issues a signed secure HTTP-only same-site cookie and processing requires session", async () => {
  await setup();
  try {
    const response = await loginPost(req("https://margin.test/api/judge-preview/login", { password: testPassword }));
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie") || "";
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Max-Age=3600/);
    const token = (cookie.split(";")[0] ?? "").split("=").slice(1).join("=");
    assert.equal(verifySession(token, sessionSecret), true);
    const sessionStatus = await sessionGet(new Request("https://margin.test/api/judge-preview/session", { headers: { Host: "margin.test", Cookie: cookie.split(";")[0] ?? "" } }));
    assert.deepEqual(await sessionStatus.json(), { authenticated: true });
    const logout = await logoutPost(new Request("https://margin.test/api/judge-preview/logout", { method: "POST", headers: { Host: "margin.test", Origin: "https://margin.test", "x-vercel-forwarded-for": "192.0.2.9" } }));
    assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/);
    assert.equal((await investigatePost(req("https://margin.test/api/investigate", { documents: [{}, {}, {}] }))).status, 403);
    assert.equal((await auditPost(req("https://margin.test/api/audit", {}))).status, 403);
    const noCookieForm = new FormData(); noCookieForm.set("file", new File(["bad"], "bad.pdf", { type: "application/pdf" }));
    const noCookieUpload = new Request("https://margin.test/api/ingest/pdf", { method: "POST", headers: { Host: "margin.test", Origin: "https://margin.test", "x-vercel-forwarded-for": "192.0.2.9", "Content-Length": "80" }, body: noCookieForm });
    assert.equal((await ingestPost(noCookieUpload)).status, 403);
    const authenticated = await investigatePost(req("https://margin.test/api/investigate", { documents: [{}, {}, {}] }, cookie.split(";")[0] ?? ""));
    assert.equal(authenticated.status, 400); // Auth/quota passed; malformed payload fails before any provider request.
    const csrfRequest = new Request("https://margin.test/api/audit", { method: "POST", headers: { Host: "margin.test", Cookie: cookie.split(";")[0] ?? "", "x-vercel-forwarded-for": "192.0.2.9", "Content-Type": "application/json", "Content-Length": "2" }, body: "{}" });
    assert.equal((await auditPost(csrfRequest)).status, 403);
  } finally { restore(); }
});

test("login throttles persistent attempts, rejects failed store operations, and rejects bad credentials", async () => {
  await setup();
  try {
    installRedis(0);
    assert.equal((await loginPost(req("https://margin.test/api/judge-preview/login", { password: testPassword }))).status, 429);
    installRedis("fail");
    assert.equal((await loginPost(req("https://margin.test/api/judge-preview/login", { password: testPassword }))).status, 403);
    installRedis(1);
    assert.equal((await loginPost(req("https://margin.test/api/judge-preview/login", { password: "wrong-password" }))).status, 403);
  } finally { restore(); }
});

test("investigation quota exhaustion and unavailable Redis fail closed on every processing endpoint", async () => {
  await setup();
  try {
    const token = issueSession(sessionSecret);
    const cookie = `mg_judge_session=${token}`;
    installRedis(0);
    // Small, structurally valid documents from the synthetic C1 / P1 / I1 case.
    // They pass route validation so this assertion exercises quota reservation.
    const body = { documents: [
      { id: "C1", type: "contract", pages: [{ page: 1, text: "Contract C1 Supplier S1 INR valid 2025-01-01 SKU-X price 100" }] },
      { id: "P1", type: "purchase_order", pages: [{ page: 1, text: "PO P1 Supplier S1 contract C1 INR 2025-07-01 SKU-X quantity 10 price 100" }] },
      { id: "I1", type: "invoice", pages: [{ page: 1, text: "Invoice I1 Supplier S1 PO P1 INR 2025-07-02 SKU-X quantity 10 price 120" }] }
    ] };
    let groqRequests = 0;
    globalThis.fetch = (async (input) => {
      if (String(input).startsWith("https://api.groq.com/")) groqRequests += 1;
      return Response.json({ result: 0 });
    }) as typeof fetch;
    assert.equal((await investigatePost(req("https://margin.test/api/investigate", body, cookie))).status, 429);
    assert.equal(groqRequests, 0, "quota exhaustion must happen before any Groq request");
    installRedis("fail");
    assert.equal((await investigatePost(req("https://margin.test/api/investigate", body, cookie))).status, 403);
    assert.equal(groqRequests, 0, "Redis failure must happen before any Groq request");
    const form = new FormData(); form.set("file", new File(["%PDF-"], "a.pdf", { type: "application/pdf" }));
    const uploadReq = new Request("https://margin.test/api/ingest/pdf", { method: "POST", headers: { Host: "margin.test", Origin: "https://margin.test", "x-vercel-forwarded-for": "192.0.2.9", Cookie: cookie }, body: form });
    const upload = await ingestPost(uploadReq);
    assert.equal(upload.status, 403);
    assert.equal((await auditPost(req("https://margin.test/api/audit", {}, cookie))).status, 403);
  } finally { restore(); }
});

test("authenticated invalid PDFs are rejected before extraction output is returned", async () => {
  await setup();
  try {
    const cookie = `mg_judge_session=${issueSession(sessionSecret)}`;
    installRedis(1);
    const form = new FormData(); form.set("file", new File(["not a PDF"], "bad.pdf", { type: "application/pdf" }));
    const uploadReq = new Request("https://margin.test/api/ingest/pdf", { method: "POST", headers: { Host: "margin.test", Origin: "https://margin.test", "x-vercel-forwarded-for": "192.0.2.9", Cookie: cookie }, body: form });
    assert.equal((await ingestPost(uploadReq)).status, 400);
  } finally { restore(); }
});

test("session expiry is enforced and production preview remains disabled without configuration", async () => {
  const expired = issueSession(sessionSecret, Date.now() - 2 * 60 * 60 * 1000);
  assert.equal(verifySession(expired, sessionSecret), false);
  await setup();
  try {
    const expiredCookie = `mg_judge_session=${expired}`;
    assert.equal((await investigatePost(req("https://margin.test/api/investigate", { documents: [] }, expiredCookie))).status, 403);
    delete env.JUDGE_PREVIEW_PASSWORD_HASH;
    const response = await investigatePost(req("https://margin.test/api/investigate", { documents: [] }));
    assert.equal(response.status, 403);
    assert.equal((await loginPost(req("https://margin.test/api/judge-preview/login", { password: testPassword }))).status, 403);
    const audit = await auditPost(req("https://margin.test/api/audit", {}));
    assert.equal(audit.status, 403);
    const form = new FormData(); form.set("file", new File(["not parsed"], "invoice.pdf", { type: "application/pdf" }));
    const upload = await ingestPost(new Request("https://margin.test/api/ingest/pdf", { method: "POST", headers: { Host: "margin.test", Origin: "https://margin.test", "x-vercel-forwarded-for": "192.0.2.9", "Content-Length": "100" }, body: form }));
    assert.equal(upload.status, 403);
  } finally { restore(); }
});

test("bounded bodies reject actual oversize JSON and multipart data with missing or false lengths", async () => {
  await setup();
  try {
    const cookie = `mg_judge_session=${issueSession(sessionSecret)}`;
    const oversizedJson = JSON.stringify({ documents: [{}, {}, {}], text: "x".repeat(1024 * 1024) });
    const noLength = new Request("https://margin.test/api/investigate", { method: "POST", headers: { Host: "margin.test", Origin: "https://margin.test", "x-vercel-forwarded-for": "192.0.2.9", Cookie: cookie, "Content-Type": "application/json" }, body: oversizedJson });
    assert.equal((await investigatePost(noLength)).status, 413);
    const understatedLength = new Request("https://margin.test/api/investigate", { method: "POST", headers: { Host: "margin.test", Origin: "https://margin.test", "x-vercel-forwarded-for": "192.0.2.9", Cookie: cookie, "Content-Type": "application/json", "Content-Length": "2" }, body: JSON.stringify({ documents: [{}, {}, {}] }) });
    assert.equal((await investigatePost(understatedLength)).status, 400);
    const excessivePages = { documents: [{ pages: Array.from({ length: 251 }, () => ({ page: 1, text: "x" })) }, { pages: [{ page: 1, text: "x" }] }, { pages: [{ page: 1, text: "x" }] }] };
    assert.equal((await investigatePost(req("https://margin.test/api/investigate", excessivePages, cookie))).status, 400);
    const overstatedLength = new Request("https://margin.test/api/investigate", { method: "POST", headers: { Host: "margin.test", Origin: "https://margin.test", "x-vercel-forwarded-for": "192.0.2.9", Cookie: cookie, "Content-Type": "application/json", "Content-Length": String(2 * 1024 * 1024) }, body: "{}" });
    assert.equal((await investigatePost(overstatedLength)).status, 413);
    const noLengthForm = new FormData(); noLengthForm.set("file", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" }));
    const largeMultipart = new Request("https://margin.test/api/ingest/pdf", { method: "POST", headers: { Host: "margin.test", Origin: "https://margin.test", "x-vercel-forwarded-for": "192.0.2.9", Cookie: cookie }, body: noLengthForm });
    assert.equal((await ingestPost(largeMultipart)).status, 413);
  } finally { restore(); }
});

test("client limits ignore spoofable X-Forwarded-For and use only Vercel's client IP header", async () => {
  await setup();
  try {
    const config = previewConfig(); assert.ok(config);
    const first = new Request("https://margin.test/", { headers: { "x-vercel-forwarded-for": "198.51.100.1", "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.1" } });
    const spoofed = new Request("https://margin.test/", { headers: { "x-vercel-forwarded-for": "198.51.100.1", "x-forwarded-for": "203.0.113.8", "x-real-ip": "203.0.113.8" } });
    assert.equal(clientKey(first, config), clientKey(spoofed, config));
    const vercel = new Request("https://margin.test/", { headers: { "x-vercel-forwarded-for": "192.0.2.3", "x-forwarded-for": "203.0.113.8" } });
    assert.notEqual(clientKey(vercel, config), clientKey(first, config));
    assert.throws(() => clientKey(new Request("https://margin.test/", { headers: { "x-forwarded-for": "198.51.100.1" } }), config));
  } finally { restore(); }
});

test("production CSRF origin validation matches the Vercel request host and requires HTTPS", async () => {
  await setup();
  try {
    const same = new Request("https://margin.test/api/judge-preview/login", { method: "POST", headers: { Host: "margin.test", Origin: "https://margin.test" } });
    const wrongHost = new Request("https://margin.test/api/judge-preview/login", { method: "POST", headers: { Host: "margin.test", Origin: "https://attacker.test" } });
    const httpOrigin = new Request("https://margin.test/api/judge-preview/login", { method: "POST", headers: { Host: "margin.test", Origin: "http://margin.test" } });
    assert.equal(requestHasSameOrigin(same), true);
    assert.equal(requestHasSameOrigin(wrongHost), false);
    assert.equal(requestHasSameOrigin(httpOrigin), false);
  } finally { restore(); }
});

test("homepage, synthetic demo, and evaluation remain publicly renderable", () => {
  assert.ok(Home()); assert.ok(DemoPage()); assert.ok(EvaluationPage());
});
