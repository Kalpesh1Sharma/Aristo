export type BoundedBody = { ok: true; bytes: Uint8Array } | { ok: false; reason: "too_large" | "invalid_length" };

/** Read at most `maxBytes` from the actual stream. Content-Length is only an early hint. */
export async function readBoundedBody(request: Request, maxBytes: number): Promise<BoundedBody> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) return { ok: false, reason: "invalid_length" };
    if (Number(declared) > maxBytes) return { ok: false, reason: "too_large" };
  }
  if (!request.body) return declared && Number(declared) !== 0 ? { ok: false, reason: "invalid_length" } : { ok: true, bytes: new Uint8Array() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }

  if (declared !== null && Number(declared) !== total) return { ok: false, reason: "invalid_length" };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { ok: true, bytes };
}

export function boundedBodyError(reason: "too_large" | "invalid_length", maxBytes: number) {
  return Response.json({ error: reason === "too_large" ? `Request payload exceeds the ${maxBytes} byte limit` : "Invalid request length" }, { status: reason === "too_large" ? 413 : 400 });
}
