/**
 * A caught value is `unknown`, not `Error` — anything can be thrown. Use this
 * to reach for a message without widening the catch binding to `any`.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}
