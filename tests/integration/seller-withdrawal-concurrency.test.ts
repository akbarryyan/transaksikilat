import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sellerState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

const payout = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/seller", () => ({
  requireSellerSession: async () => sellerState.current,
}));

vi.mock("@/src/infra/payment/poppay/poppay.client", () => ({
  PoppayClient: class {
    async createOutgoing() {
      payout.calls += 1;
      return { refId: "ref-test", aggregatorRefId: "agg-test", raw: {} };
    }
    async listBanks() {
      return { data: [] };
    }
  },
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { POST as requestWithdrawal } from "@/app/api/seller/withdrawals/route";

const CONCURRENCY = 10;
const BALANCE = 1000;

async function createSeller(balance: number): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `seller-${Date.now()}@example.test`,
      name: "Seller Subject",
      role: "MEMBER",
      wallet: { create: { balance } },
    },
  });

  sellerState.current = {
    session: { isLoggedIn: true, userId: user.id, role: "MEMBER" },
    sellerProfile: { userId: user.id, isActive: true },
  };

  return user.id;
}

function withdrawalRequest(amount: number): NextRequest {
  return new NextRequest("http://localhost/api/seller/withdrawals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      amount,
      bankCode: "014",
      accountName: "Seller Subject",
      accountNumber: "1234567890",
      bankName: "BCA",
    }),
  });
}

describe("seller withdrawals under concurrency", () => {
  beforeEach(async () => {
    await resetDatabase();
    payout.calls = 0;
  });

  it("pays out only what the seller actually has when requests land at once", async () => {
    const userId = await createSeller(BALANCE);

    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        requestWithdrawal(withdrawalRequest(BALANCE))
      )
    );

    const accepted = responses.filter((response) => response.status === 200);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    const approved = await prisma.sellerWithdrawalRequest.count({
      where: { userId, status: "APPROVED" },
    });

    // A balance of 1000 funds exactly one withdrawal of 1000. Anything more is
    // money leaving to a real bank account that the seller never had.
    expect(accepted).toHaveLength(1);
    expect(payout.calls).toBe(1);
    expect(approved).toBe(1);
    expect(Number(wallet.balance)).toBe(0);
  });
});
