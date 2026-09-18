import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/lib/session", () => ({
  getSession: async () => sessionState.current,
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { POST as adminWalletPost } from "@/app/api/admin/wallet/route";
import { OrderRepository } from "@/src/infra/db/repositories/order.repository";

const CONCURRENCY = 10;
const AMOUNT = 1000;

async function createUserWithWallet(balance: number): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `wallet-race-${Date.now()}-${Math.random()}@example.test`,
      name: "Wallet Race Subject",
      role: "MEMBER",
      wallet: { create: { balance } },
    },
  });
  return user.id;
}

function walletRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/admin/wallet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function ledgerSum(userId: string, type: string): Promise<number> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  const result = await prisma.ledgerEntry.aggregate({
    where: { walletId: wallet.id, type },
    _sum: { amount: true },
  });
  return Number(result._sum.amount ?? 0);
}

async function balanceOf(userId: string): Promise<number> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  return Number(wallet.balance);
}

describe("wallet writes under concurrency", () => {
  beforeEach(async () => {
    await resetDatabase();
    sessionState.current = {
      isLoggedIn: true,
      userId: "admin-1",
      role: "ADMIN",
    };
  });

  it("credits every rupiah when credits land at once", async () => {
    const userId = await createUserWithWallet(0);

    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        adminWalletPost(
          walletRequest({ action: "CREDIT", userId, amount: AMOUNT })
        )
      )
    );

    const accepted = responses.filter((response) => response.status === 200);
    const expected = CONCURRENCY * AMOUNT;

    expect(accepted).toHaveLength(CONCURRENCY);
    expect(await ledgerSum(userId, "CREDIT")).toBe(expected);
    expect(await balanceOf(userId)).toBe(expected);
  });

  it("lets only one of many simultaneous debits spend the last balance", async () => {
    const userId = await createUserWithWallet(AMOUNT);

    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        adminWalletPost(
          walletRequest({ action: "DEBIT", userId, amount: AMOUNT })
        )
      )
    );

    const accepted = responses.filter((response) => response.status === 200);

    // A wallet holding 1000 can fund exactly one debit of 1000.
    expect(accepted).toHaveLength(1);
    expect(await ledgerSum(userId, "DEBIT")).toBe(AMOUNT);
    expect(await balanceOf(userId)).toBe(0);
  });

  it("lets only one of many simultaneous holds reserve the last balance", async () => {
    const userId = await createUserWithWallet(AMOUNT);
    const repository = new OrderRepository();

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, index) =>
        repository.holdWalletBalance(userId, AMOUNT, `order-${index}`)
      )
    );

    const held = results.filter((result) => result !== null);

    expect(held).toHaveLength(1);
    expect(await ledgerSum(userId, "HOLD")).toBe(AMOUNT);
    expect(await balanceOf(userId)).toBe(0);
  });

  it("returns every released hold to the balance when releases land at once", async () => {
    const userId = await createUserWithWallet(0);
    const repository = new OrderRepository();

    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, index) =>
        repository.releaseWalletHold(userId, AMOUNT, `order-${index}`)
      )
    );

    const expected = CONCURRENCY * AMOUNT;

    expect(await ledgerSum(userId, "RELEASE")).toBe(expected);
    expect(await balanceOf(userId)).toBe(expected);
  });
});
