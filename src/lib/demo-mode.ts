/** Production deployments remain synthetic-only until access and quotas are enforced. */
export function isDemoMode() {
  // Production has no authorized-access or quota enforcement yet. Keep every
  // live processing API closed regardless of deployment configuration.
  if (process.env.NODE_ENV === "production") return true;
  const configured = process.env.DEMO_MODE?.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(configured ?? "")) return true;
  if (["0", "false", "off", "no"].includes(configured ?? "")) return false;
  return false;
}
