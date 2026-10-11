/** Production deployments remain synthetic-only unless the complete judge gate is explicitly opened. */
export function isDemoMode() {
  // Public production processing remains closed until the separate judge gate
  // is explicitly enabled and its complete configuration is valid.
  // The route-level preview gate still rejects incomplete configuration.
  if (process.env.NODE_ENV === "production") return process.env.JUDGE_PREVIEW_ENABLED !== "true" || ["1", "true", "on", "yes"].includes(process.env.DEMO_MODE?.trim().toLowerCase() ?? "");
  const configured = process.env.DEMO_MODE?.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(configured ?? "")) return true;
  if (["0", "false", "off", "no"].includes(configured ?? "")) return false;
  return false;
}
