/** Public production deployments are synthetic-only unless explicitly opted out. */
export function isDemoMode() {
  const configured = process.env.DEMO_MODE?.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(configured ?? "")) return true;
  if (["0", "false", "off", "no"].includes(configured ?? "")) return false;
  return process.env.NODE_ENV === "production";
}
