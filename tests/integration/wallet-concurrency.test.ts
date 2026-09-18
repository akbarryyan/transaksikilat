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

const CONCURRENT_CREDITS = 10;
const CREDIT_AMOUNT = 1000;

async function createUserWithWallet(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `wallet-race-${Date.now()}@example.test`,
      name: "Wallet Race Subject",
      role: "MEMBER",
      wallet: { create: { balance: 0 } },
    },
  });
  return user.id;
}

function creditRequest(userId: string): NextRequest {
  return new NextRequest("http://localhost/api/admin/wallet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "CREDIT",
      userId,
      amount: CREDIT_AMOUNT,
      description: "concurrency probe",
    }),
  });
}

describe("wallet balance under concurrent writes", () => {
  beforeEach(async () => {
    await resetDatabase();
    sessionState.current = {
      isLoggedIn: true,
      userId: "admin-1",
      role: "ADMIN",
    };
  });

  // KNOWN BUG — `it.fails` asserts this currently does NOT hold.
  //
  // Every wallet write in this codebase reads the balance, adds to it in JS,
  // then writes an absolute value back. MySQL's REPEATABLE READ does not lock
  // a row on a plain SELECT, so concurrent transactions all read the same
  // starting balance and the last write wins. Observed here: all 10 credits
  // returned HTTP 200 and wrote 10 ledger entries totalling 10000, while the
  // balance moved by 1000 — 9000 lost, and the ledger no longer reconciles
  // against the balance.
  //
  // Fixing it means atomic writes (`{ increment }`, plus a `balance >= amount`
  // guard on debits) everywhere money touches a wallet. When that lands, this
  // test starts passing and Vitest will flag the `.fails` — drop `.fails` then.
  it.fails("keeps the balance consistent with the ledger when credits land at once", async () => {
    const userId = await createUserWithWallet();

    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_CREDITS }, () =>
        adminWalletPost(creditRequest(userId))
      )
    );

    const accepted = responses.filter((response) => response.status === 200);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    const ledgerTotal = await prisma.ledgerEntry.aggregate({
      where: { walletId: wallet.id },
      _sum: { amount: true },
    });

    const expected = CONCURRENT_CREDITS * CREDIT_AMOUNT;

    // Every credit was accepted, so every rupiah must be on the balance.
    expect(accepted).toHaveLength(CONCURRENT_CREDITS);
    expect(Number(ledgerTotal._sum.amount ?? 0)).toBe(expected);
    expect(Number(wallet.balance)).toBe(expected);
  });
});
