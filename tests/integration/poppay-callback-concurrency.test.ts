import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/infra/payment/poppay/poppay.client", () => ({
  PoppayClient: class {
    async inquireIncoming() {
      return { status: "completed" };
    }
  },
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { handlePoppayCallback } from "@/lib/poppay-callback";
import type { PoppayCallbackPayload } from "@/lib/poppay-callback";

const AMOUNT = 50000;

const POPPAY_STATUS_COMPLETED = 5;
const POPPAY_STATUS_REJECTED = 1;

async function createUser(balance: number): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `poppay-${Date.now()}-${Math.random()}@example.test`,
      name: "Poppay Subject",
      role: "MEMBER",
      wallet: { create: { balance } },
    },
  });
  return user.id;
}

async function createApprovedWithdrawal(userId: string) {
  return prisma.sellerWithdrawalRequest.create({
    data: {
      userId,
      amount: AMOUNT,
      status: "APPROVED",
      accountName: "Poppay Subject",
      accountNumber: "1234567890",
      bankName: "BCA",
      payoutGateway: "POPPAY",
    },
  });
}

async function walletState(userId: string, ledgerType: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  const entries = await prisma.ledgerEntry.findMany({
    where: { walletId: wallet.id, type: ledgerType },
  });
  return { balance: Number(wallet.balance), entries: entries.length };
}

/**
 * Poppay's dedup key is derived from refid, so two callbacks describing the
 * same transaction with different refids both reach the handler — the webhook
 * event table does not stop them.
 */
function callbackPair(aggRefId: string, status: number): PoppayCallbackPayload[] {
  return ["ref-first", "ref-second"].map((refid) => ({
    refid,
    agg_refid: aggRefId,
    amount: AMOUNT,
    status,
  }));
}

describe("poppay callbacks under concurrency", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("credits a top-up once when two callbacks for it arrive at the same time", async () => {
    const userId = await createUser(0);
    const topupCode = "WT-20260918-9001";
    // A pending top-up always carries the gateway reference it was created
    // with — settlement is verified against that id, not against whatever
    // refid a callback happens to name.
    await prisma.walletTopup.create({
      data: {
        topupCode,
        userId,
        amount: AMOUNT,
        status: "PENDING",
        invoiceId: "poppay-ref-concurrency-test",
      },
    });

    await Promise.all(
      callbackPair(topupCode, POPPAY_STATUS_COMPLETED).map((payload) =>
        handlePoppayCallback(payload, payload)
      )
    );

    const state = await walletState(userId, "CREDIT");
    expect(state.balance).toBe(AMOUNT);
    expect(state.entries).toBe(1);
  });

  it("records a paid withdrawal once when two callbacks for it arrive at the same time", async () => {
    const userId = await createUser(0);
    const withdrawal = await createApprovedWithdrawal(userId);

    await Promise.all(
      callbackPair(`withdraw-${withdrawal.id}`, POPPAY_STATUS_COMPLETED).map(
        (payload) => handlePoppayCallback(payload, payload)
      )
    );

    const state = await walletState(userId, "WITHDRAW_PAID");
    expect(state.entries).toBe(1);
    expect(state.balance).toBe(0);

    const settled = await prisma.sellerWithdrawalRequest.findUniqueOrThrow({
      where: { id: withdrawal.id },
    });
    expect(settled.status).toBe("PAID");
  });

  it("releases a rejected withdrawal once when two callbacks for it arrive at the same time", async () => {
    const userId = await createUser(0);
    const withdrawal = await createApprovedWithdrawal(userId);

    await Promise.all(
      callbackPair(`withdraw-${withdrawal.id}`, POPPAY_STATUS_REJECTED).map(
        (payload) => handlePoppayCallback(payload, payload)
      )
    );

    // The seller's money comes back exactly once, however many callbacks land.
    const state = await walletState(userId, "WITHDRAW_RELEASE");
    expect(state.balance).toBe(AMOUNT);
    expect(state.entries).toBe(1);
  });
});
