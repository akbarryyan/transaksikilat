import { getIronSession, IronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: string;
  email?: string;
  phone?: string;
  name?: string;
  role?: string; // "MEMBER" | "ADMIN"
  isLoggedIn?: boolean;
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

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  return session;
}
