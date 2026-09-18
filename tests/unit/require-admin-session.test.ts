import { describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/lib/session", () => ({
  getSession: async () => sessionState.current,
}));

import { requireAdminSession } from "@/lib/admin";

describe("requireAdminSession", () => {
  it("rejects a request with no session", async () => {
    sessionState.current = {};

    const result = await requireAdminSession();

    expect(result).toEqual({ error: "Unauthorized", status: 401 });
  });

  it("rejects a session flagged logged in but carrying no user id", async () => {
    sessionState.current = { isLoggedIn: true, role: "ADMIN" };

    const result = await requireAdminSession();

    expect(result).toEqual({ error: "Unauthorized", status: 401 });
  });

  it("rejects a logged-in non-admin", async () => {
    sessionState.current = { isLoggedIn: true, userId: "user-1", role: "MEMBER" };

    const result = await requireAdminSession();

    expect(result).toEqual({ error: "Forbidden", status: 403 });
  });

  it("accepts a logged-in admin and returns the session", async () => {
    sessionState.current = { isLoggedIn: true, userId: "admin-1", role: "ADMIN" };

    const result = await requireAdminSession();

    expect(result).not.toHaveProperty("error");
    expect(result).toHaveProperty("session");
    expect((result as { session: { userId: string } }).session.userId).toBe("admin-1");
  });
});
