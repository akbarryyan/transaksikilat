import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

// Login establishes a session rather than consuming one, so it reaches for the
// raw cookie; the admin route also verifies sessions on its GET.
vi.mock("@/lib/session", () => ({
  getRawSession: async () => ({ save: async () => {} }),
  getSession: async () => ({ save: async () => {} }),
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { POST as memberLogin } from "@/app/api/auth/login/route";
import { POST as adminLogin } from "@/app/api/admin/auth/route";

const EMAIL = "brute-force-target@example.test";
const PASSWORD = "correct-horse-battery";
const WRONG_PASSWORD = "wrong-password";

const MAX_ATTEMPTS = 5;

async function createUser(role: "MEMBER" | "ADMIN"): Promise<void> {
  await prisma.user.create({
    data: {
      email: EMAIL,
      name: "Brute Force Target",
      role,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      isActive: true,
    },
  });
}

function memberRequest(password: string): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({ identifier: EMAIL, password, method: "email" }),
  });
}

function adminRequest(password: string): Request {
  return new Request("http://localhost/api/admin/auth", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({ email: EMAIL, password }),
  });
}

const MAX_ATTEMPTS_PER_IP = 20;

/** A login attempt for an account that does not exist, from a chosen IP. */
function strangerRequest(identifier: string, ip: string): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ identifier, password: WRONG_PASSWORD, method: "email" }),
  });
}

async function attempt(
  login: (request: never) => Promise<Response>,
  request: Request
): Promise<number> {
  const response = await login(request as never);
  return response.status;
}

describe("login brute-force throttling", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("stops accepting attempts for an identifier after repeated wrong passwords", async () => {
    await createUser("MEMBER");

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      expect(await attempt(memberLogin, memberRequest(WRONG_PASSWORD))).toBe(401);
    }

    // Even the right password is refused once the identifier is locked out,
    // so a guessed password cannot be confirmed by trying it.
    expect(await attempt(memberLogin, memberRequest(PASSWORD))).toBe(429);
  });

  it("still lets the right password through before the limit", async () => {
    await createUser("MEMBER");

    expect(await attempt(memberLogin, memberRequest(WRONG_PASSWORD))).toBe(401);
    expect(await attempt(memberLogin, memberRequest(PASSWORD))).toBe(200);
  });

  it("forgets earlier failures once a login succeeds", async () => {
    await createUser("MEMBER");

    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      await attempt(memberLogin, memberRequest(WRONG_PASSWORD));
    }
    expect(await attempt(memberLogin, memberRequest(PASSWORD))).toBe(200);

    // The counter reset, so the next wrong password is an ordinary refusal.
    expect(await attempt(memberLogin, memberRequest(WRONG_PASSWORD))).toBe(401);
  });

  it("throttles the admin login too", async () => {
    await createUser("ADMIN");

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      expect(await attempt(adminLogin, adminRequest(WRONG_PASSWORD))).toBe(401);
    }

    expect(await attempt(adminLogin, adminRequest(PASSWORD))).toBe(429);
  });
  it("locks a source IP that works through many accounts, not just one", async () => {
    // Spreading guesses across identifiers keeps every per-identifier counter
    // under its limit — the per-IP ceiling is the only thing that stops a
    // sweep through a list of emails.
    await createUser("MEMBER");

    for (let i = 0; i < MAX_ATTEMPTS_PER_IP; i += 1) {
      expect(
        await attempt(memberLogin, strangerRequest(`sweep-${i}@example.test`, "198.51.100.4"))
      ).toBe(401);
    }

    // A fresh identifier from that IP is refused even though it has no
    // failures of its own.
    expect(
      await attempt(memberLogin, strangerRequest("belum-pernah@example.test", "198.51.100.4"))
    ).toBe(429);
  });

  it("does not punish a different IP for that sweep", async () => {
    await createUser("MEMBER");

    for (let i = 0; i < MAX_ATTEMPTS_PER_IP; i += 1) {
      await attempt(memberLogin, strangerRequest(`sweep-${i}@example.test`, "198.51.100.4"));
    }

    // The real user behind another address still gets in.
    expect(await attempt(memberLogin, memberRequest(PASSWORD))).toBe(200);
  });
});
