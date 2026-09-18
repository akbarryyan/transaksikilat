import { beforeEach, describe, expect, it } from "vitest";

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { handleWalletTopupWebhook } from "@/lib/wallet-topup-webhook";
import type { IPaymentGatewayPort } from "@/src/core/ports/payment-gateway.port";

const TOPUP_CODE = "WT-20260918-0001";
const TOPUP_AMOUNT = 50000;

// Payment gateways retry callbacks, so the same "completed" notification can
// arrive more than once — and the handler confirms status against the gateway,
// which keeps answering "completed".
const gatewayConfirmingPayment = {
  detailPayment: async () => ({
    status: "completed",
    method: "QRIS",
    paidAt: new Date(),
    fee: 0,
    totalPayment: TOPUP_AMOUNT,
  }),
} as unknown as IPaymentGatewayPort;

async function createPendingTopup(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `topup-${Date.now()}@example.test`,
      name: "Topup Subject",
      role: "MEMBER",
      wallet: { create: { balance: 0 } },
    },
  });

  await prisma.walletTopup.create({
    data: {
      topupCode: TOPUP_CODE,
      userId: user.id,
      amount: TOPUP_AMOUNT,
      status: "PENDING",
    },
  });

  return user.id;
}

async function walletState(userId: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  const credited = await prisma.ledgerEntry.aggregate({
    where: { walletId: wallet.id, type: "CREDIT" },
    _sum: { amount: true },
  });
  return {
    balance: Number(wallet.balance),
    credited: Number(credited._sum.amount ?? 0),
  };
}

describe("wallet top-up webhook", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("credits the wallet once when the callback is delivered twice in a row", async () => {
    const userId = await createPendingTopup();
    const payload = { order_id: TOPUP_CODE, status: "completed", amount: TOPUP_AMOUNT };

    await handleWalletTopupWebhook(payload, gatewayConfirmingPayment);
    await handleWalletTopupWebhook(payload, gatewayConfirmingPayment);

    const state = await walletState(userId);
    expect(state.balance).toBe(TOPUP_AMOUNT);
    expect(state.credited).toBe(TOPUP_AMOUNT);
  });

  it("credits the wallet once when two callbacks arrive at the same time", async () => {
    const userId = await createPendingTopup();
    const payload = { order_id: TOPUP_CODE, status: "completed", amount: TOPUP_AMOUNT };

    await Promise.all([
      handleWalletTopupWebhook(payload, gatewayConfirmingPayment),
      handleWalletTopupWebhook(payload, gatewayConfirmingPayment),
    ]);

    const state = await walletState(userId);
    expect(state.balance).toBe(TOPUP_AMOUNT);
    expect(state.credited).toBe(TOPUP_AMOUNT);
  });
});
