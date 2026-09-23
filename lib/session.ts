import { getIronSession, IronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { prisma } from "@/src/infra/db/prisma";

export interface SessionData {
  userId?: string;
  email?: string;
  phone?: string;
  name?: string;
  role?: string; // "MEMBER" | "ADMIN"
  isLoggedIn?: boolean;
  /**
   * The account's sessionVersion at the moment this cookie was sealed. The
   * cookie is self-contained and nothing server-side tracks it, so this is what
   * makes revoking it possible at all.
   */
  sessionVersion?: number;
}

/**
 * Any production deployment of this app is expected to run behind HTTPS —
 * tying this to a string match against APP_URL meant a missing or
 * misconfigured env var silently stripped Secure from the session cookie
 * while the app was still served over HTTPS behind a proxy.
 */
export function shouldUseSecureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET as string,
  cookieName: "whuzpay_session",
  cookieOptions: {
    secure: shouldUseSecureCookies(),
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 hari
  },
};

/**
 * The sealed cookie as it arrived, with no question of whether it still stands
 * for a usable account. Only for the endpoints that establish or tear down a
 * session — everything else wants getSession().
 */
export async function getRawSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/**
 * True when this cookie should no longer be honoured.
 *
 * Sessions here are sealed cookies with no server-side record, so changing a
 * password used to leave every cookie already out there working for the rest of
 * its seven days — which meant the one thing a victim does after a break-in did
 * not actually remove the intruder. Comparing against a counter on the account
 * is what gives that action teeth.
 */
export async function isSessionRevoked(
  session: Pick<SessionData, "userId" | "sessionVersion">
): Promise<boolean> {
  if (!session.userId) return true;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isActive: true, sessionVersion: true },
  });

  if (!user || !user.isActive) return true;

  // A cookie sealed before this field existed carries nothing. Reading that as
  // version 0 — where every account starts — is what stops the deploy itself
  // signing everybody out.
  return (session.sessionVersion ?? 0) !== user.sessionVersion;
}

/**
 * The session for this request, already checked against the account it claims.
 * A cookie that has been revoked is destroyed here, so callers see a signed-out
 * session and the browser stops sending it.
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  const session = await getRawSession();

  if (!session.isLoggedIn || !session.userId) return session;

  if (await isSessionRevoked(session)) {
    session.destroy();
  }

  return session;
}

/**
 * Makes every cookie already issued for this account stop working. The caller
 * keeping its own session alive has to copy the returned value into it first.
 */
export async function revokeUserSessions(userId: string): Promise<number> {
  const { sessionVersion } = await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });

  return sessionVersion;
}
