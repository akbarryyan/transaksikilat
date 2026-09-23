import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  saves: 0,
}));

// Only getSession is swapped; the revocation helpers under test stay real.
vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return { ...actual, getSession: async () => sessionState.current };
});

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { isSessionRevoked, revokeUserSessions } from "@/lib/session";
import { POST as changePassword } from "@/app/api/auth/change-password/route";
import { POST as resetPassword } from "@/app/api/auth/reset-password/route";

const OLD_PASSWORD = "kata-sandi-lama";
const NEW_PASSWORD = "kata-sandi-baru-9";

async function createUser(overrides: { isActive?: boolean } = {}) {
  return prisma.user.create({
    data: {
      email: `revoke-${Date.now()}-${Math.random()}@example.test`,
      name: "Revoke Subject",
      role: "MEMBER",
      isActive: overrides.isActive ?? true,
      passwordHash: await bcrypt.hash(OLD_PASSWORD, 10),
    },
  });
}

function signIn(userId: string, sessionVersion?: number) {
  sessionState.current = {
    isLoggedIn: true,
    userId,
    sessionVersion,
    save: async () => {
      sessionState.saves += 1;
    },
  };
  return sessionState.current;
}

function jsonRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/auth/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("session revocation", () => {
  beforeEach(async () => {
    await resetDatabase();
    sessionState.current = {};
    sessionState.saves = 0;
  });

  it("accepts a session carrying the account's current version", async () => {
    const user = await createUser();

    expect(await isSessionRevoked({ userId: user.id, sessionVersion: 0 })).toBe(false);
  });

  it("refuses a session issued before the account was revoked", async () => {
    const user = await createUser();
    await revokeUserSessions(user.id);

    expect(await isSessionRevoked({ userId: user.id, sessionVersion: 0 })).toBe(true);
  });

  it("keeps sessions that predate the version field working", async () => {
    // Cookies sealed before this feature carry no version at all. Treating that
    // as version 0 is what stops the deploy itself logging everybody out.
    const user = await createUser();

    expect(await isSessionRevoked({ userId: user.id })).toBe(false);

    await revokeUserSessions(user.id);
    expect(await isSessionRevoked({ userId: user.id })).toBe(true);
  });

  it("refuses a session for a deactivated account", async () => {
    const user = await createUser({ isActive: false });

    expect(await isSessionRevoked({ userId: user.id, sessionVersion: 0 })).toBe(true);
  });

  it("refuses a session for an account that no longer exists", async () => {
    expect(await isSessionRevoked({ userId: "tidak-ada", sessionVersion: 0 })).toBe(true);
  });

  it("cuts other sessions loose when the password is changed, but not the one doing it", async () => {
    const user = await createUser();
    const session = signIn(user.id, 0);

    const res = await changePassword(
      jsonRequest({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })
    );
    expect(res.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.sessionVersion).toBe(1);

    // A cookie from before the change is now worthless...
    expect(await isSessionRevoked({ userId: user.id, sessionVersion: 0 })).toBe(true);
    // ...while the browser that made the change stays signed in.
    expect(session.sessionVersion).toBe(1);
    expect(await isSessionRevoked({ userId: user.id, sessionVersion: 1 })).toBe(false);
  });

  it("cuts every session loose when the password is reset", async () => {
    const user = await createUser();
    await prisma.otpCode.create({
      data: {
        email: user.email!,
        target: "email",
        code: "123456",
        purpose: "RESET_PASSWORD",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    const res = await resetPassword(
      jsonRequest({
        identifier: user.email,
        method: "email",
        code: "123456",
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      })
    );
    expect(res.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.sessionVersion).toBe(1);
    expect(await isSessionRevoked({ userId: user.id, sessionVersion: 0 })).toBe(true);
  });
});
