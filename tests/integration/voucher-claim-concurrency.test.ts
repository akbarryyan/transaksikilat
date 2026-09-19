import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/lib/session", () => ({
  getSession: async () => sessionState.current,
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { POST as claimVoucher } from "@/app/api/vouchers/claim/route";

const CONCURRENCY = 10;

async function createVoucher(quota: number | null) {
  return prisma.voucher.create({
    data: {
      code: `RACE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase(),
      title: "Race Test Voucher",
      discountType: "FIXED",
      discountValue: 5000,
      quota,
      perUserLimit: 1,
      usedCount: quota !== null ? quota - 1 : 0,
    },
  });
}

async function createUsers(count: number): Promise<string[]> {
  const users = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      prisma.user.create({
        data: {
          email: `voucher-race-${Date.now()}-${i}-${Math.random()}@example.test`,
          name: `Voucher Race Subject ${i}`,
          role: "MEMBER",
        },
      })
    )
  );
  return users.map((u) => u.id);
}

function claimRequest(code: string): Request {
  return new Request("http://localhost/api/vouchers/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

describe("voucher claim under concurrency", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets only one of many simultaneous claims take the last slot in the quota", async () => {
    const voucher = await createVoucher(10); // 9 already used, 1 slot left
    const userIds = await createUsers(CONCURRENCY);

    const responses = await Promise.all(
      userIds.map((userId) => {
        sessionState.current = { isLoggedIn: true, userId, role: "MEMBER" };
        return claimVoucher(claimRequest(voucher.code));
      })
    );

    const bodies = await Promise.all(responses.map((r) => r.json()));
    const accepted = bodies.filter((b) => b.success);

    // A voucher with 1 slot left must yield exactly one successful claim,
    // however many requests land on it at once.
    expect(accepted).toHaveLength(1);

    const updated = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(updated.usedCount).toBe(10);

    const claimCount = await prisma.voucherClaim.count({ where: { voucherId: voucher.id } });
    expect(claimCount).toBe(1);
  });

  it("still allows every claim when the voucher has no quota limit", async () => {
    const voucher = await createVoucher(null);
    const userIds = await createUsers(5);

    const responses = await Promise.all(
      userIds.map((userId) => {
        sessionState.current = { isLoggedIn: true, userId, role: "MEMBER" };
        return claimVoucher(claimRequest(voucher.code));
      })
    );

    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(bodies.every((b) => b.success)).toBe(true);

    const updated = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(updated.usedCount).toBe(5);
  });

  it("rejects a claim once the quota is already exhausted", async () => {
    const voucher = await createVoucher(3);
    await prisma.voucher.update({ where: { id: voucher.id }, data: { usedCount: 3 } });
    const [userId] = await createUsers(1);
    sessionState.current = { isLoggedIn: true, userId, role: "MEMBER" };

    const response = await claimVoucher(claimRequest(voucher.code));
    const body = await response.json();

    expect(body.success).toBe(false);
    expect(response.status).toBe(400);

    const claimCount = await prisma.voucherClaim.count({ where: { voucherId: voucher.id } });
    expect(claimCount).toBe(0);
  });
});
