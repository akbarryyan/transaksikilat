/**
 * Runs once when the server starts, so a missing or malformed required
 * variable fails loudly at boot instead of surfacing as a cryptic error deep
 * inside the first request that happens to need it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertEnv } = await import("@/lib/env");
  assertEnv();
}
