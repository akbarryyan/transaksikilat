import { timingSafeEqual } from "crypto";

/**
 * How many stuck orders one sweep may reconcile. Each one costs a call to the
 * provider, so an unbounded sweep over a backlog would time out partway
 * through and leave the rest untouched. The cron runs often enough to work
 * through a backlog across several passes.
 */
export const RECONCILE_BATCH_LIMIT = 25;

/** An order is considered stuck once it has sat in PAID/PROCESSING this long. */
export const RECONCILE_STALE_MINUTES = 5;

function matches(received: string, expected: string): boolean {
  if (received.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Cron endpoints are reachable from the internet, so they authenticate with a
 * shared secret. Fails closed: with CRON_SECRET unset nothing is authorised.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : (request.headers.get("x-cron-secret") ?? "").trim();

  if (!presented) return false;

  return matches(presented, secret);
}
