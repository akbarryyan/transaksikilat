/**
 * Brute-force throttling for the login endpoints, backed by the database so
 * the limit holds across restarts and across instances.
 */

import { prisma } from "@/src/infra/db/prisma";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IDENTIFIER = 5;
const MAX_FAILURES_PER_IP = 20;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export const LOGIN_THROTTLE_MESSAGE =
  "Terlalu banyak percobaan login gagal. Coba lagi dalam 15 menit.";

export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || null;
}

/** True when this identifier or source IP has failed too often recently. */
export async function isLoginThrottled(
  identifier: string,
  ip: string | null
): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);

  const [byIdentifier, byIp] = await Promise.all([
    prisma.failedLoginAttempt.count({
      where: { identifier, createdAt: { gte: since } },
    }),
    ip
      ? prisma.failedLoginAttempt.count({ where: { ip, createdAt: { gte: since } } })
      : Promise.resolve(0),
  ]);

  return (
    byIdentifier >= MAX_FAILURES_PER_IDENTIFIER || byIp >= MAX_FAILURES_PER_IP
  );
}

export async function recordFailedLogin(
  identifier: string,
  ip: string | null
): Promise<void> {
  await prisma.failedLoginAttempt.create({ data: { identifier, ip } });

  // Keep the table bounded without needing a scheduled job.
  await prisma.failedLoginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
  });
}

/** Called after a successful login so one bad streak does not lock the owner out. */
export async function clearFailedLogins(identifier: string): Promise<void> {
  await prisma.failedLoginAttempt.deleteMany({ where: { identifier } });
}
