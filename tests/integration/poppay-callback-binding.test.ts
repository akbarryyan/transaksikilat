import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Poppay reports exactly one transaction as settled here. Every other uid is
 * still pending — which is precisely the situation a replayed proof of payment
 * creates: the refid in the callback is real and genuinely paid, but it belongs
 * to a different transaction than the one the callback claims to settle.
 */
const { SETTLED_REF, inquiredUids } = vi.hoisted(() => ({
  SETTLED_REF: "poppay-ref-transaksi-lunas",
  inquiredUids: [] as string[],
}));

vi.mock("@/src/infra/payment/poppay/poppay.client", () => ({
  PoppayClient: class {
    async inquireIncoming(uid: string) {
      inquiredUids.push(uid);
      return { uid, status: uid === SETTLED_REF ? "completed" : "pending" };
    }
  },
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { handlePoppayCallback } from "@/lib/poppay-callback";
import type { PoppayCallbackPayload } from "@/lib/poppay-callback";

const POPPAY_STATUS_COMPLETED = 5;
const TOPUP_AMOUNT = 500000;
const ORDER_AMOUNT = 12000;

async function createUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `binding-${Date.now()}-${Math.random()}@example.test`,
      name: "Binding Subject",
      role: "MEMBER",
      wallet: { create: { balance: 0 } },
    },
  });
  return user.id;
}

async function createPendingTopup(
  userId: string,
  topupCode: string,
  invoiceId: string | null
) {
  return prisma.walletTopup.create({
    data: { topupCode, userId, amount: TOPUP_AMOUNT, status: "PENDING", invoiceId },
  });
}

async function createWaitingOrder(userId: string, orderCode: string, invoiceId: string) {
  const product = await prisma.product.create({
    data: {
      provider: "DIGIFLAZZ",
      providerCode: `SKU-${Date.now()}-${Math.random()}`,
      name: "Produk Uji",
      category: "Games",
      brand: "Uji",
      type: "prepaid",
      providerPrice: 10000,
      sellingPrice: ORDER_AMOUNT,
    },
  });

  const order = await prisma.order.create({
    data: {
      orderCode,
      userId,
      productId: product.id,
      provider: "DIGIFLAZZ",
      targetNumber: "081234567890",
      basePrice: 10000,
      markup: 2000,
      amount: ORDER_AMOUNT,
      status: "WAITING_PAYMENT",
      paymentMethod: "PAYMENT_GATEWAY",
    },
  });

  await prisma.paymentInvoice.create({
    data: {
      orderId: order.id,
      gatewayName: "POPPAY",
      invoiceId,
      amount: ORDER_AMOUNT,
      status: "PENDING",
    },
  });

  return order;
}

function callback(aggRefId: string, refid: string, amount: number): PoppayCallbackPayload {
  return { refid, agg_refid: aggRefId, amount, status: POPPAY_STATUS_COMPLETED };
}

async function balanceOf(userId: string): Promise<number> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  return Number(wallet.balance);
}

describe("poppay callback binds payment proof to the record it settles", () => {
  beforeEach(async () => {
    await resetDatabase();
    inquiredUids.length = 0;
  });

  it("refuses a top-up whose callback carries another transaction's settled refid", async () => {
    const userId = await createUser();
    const topupCode = "WT-20260923-0001";
    await createPendingTopup(userId, topupCode, "poppay-ref-topup-belum-dibayar");

    const result = await handlePoppayCallback(
      callback(topupCode, SETTLED_REF, TOPUP_AMOUNT),
      callback(topupCode, SETTLED_REF, TOPUP_AMOUNT)
    );

    expect(result.action).toBe("inquiry_mismatch");
    expect(await balanceOf(userId)).toBe(0);

    const topup = await prisma.walletTopup.findUniqueOrThrow({ where: { topupCode } });
    expect(topup.status).toBe("PENDING");
  });

  it("verifies the invoice id it stored, not the refid the callback supplied", async () => {
    const userId = await createUser();
    const topupCode = "WT-20260923-0002";
    const storedInvoiceId = "poppay-ref-topup-belum-dibayar";
    await createPendingTopup(userId, topupCode, storedInvoiceId);

    await handlePoppayCallback(
      callback(topupCode, SETTLED_REF, TOPUP_AMOUNT),
      callback(topupCode, SETTLED_REF, TOPUP_AMOUNT)
    );

    expect(inquiredUids).toContain(storedInvoiceId);
    expect(inquiredUids).not.toContain(SETTLED_REF);
  });

  it("refuses an order whose callback carries another transaction's settled refid", async () => {
    const userId = await createUser();
    const orderCode = "WP-260923-A1B2C3";
    await createWaitingOrder(userId, orderCode, "poppay-ref-order-belum-dibayar");

    const result = await handlePoppayCallback(
      callback(orderCode, SETTLED_REF, ORDER_AMOUNT),
      callback(orderCode, SETTLED_REF, ORDER_AMOUNT)
    );

    expect(result.action).toBe("inquiry_mismatch");

    const order = await prisma.order.findUniqueOrThrow({ where: { orderCode } });
    expect(order.status).toBe("WAITING_PAYMENT");
  });

  it("refuses a top-up that has no stored invoice id to verify against", async () => {
    const userId = await createUser();
    const topupCode = "WT-20260923-0003";
    await createPendingTopup(userId, topupCode, null);

    const result = await handlePoppayCallback(
      callback(topupCode, SETTLED_REF, TOPUP_AMOUNT),
      callback(topupCode, SETTLED_REF, TOPUP_AMOUNT)
    );

    expect(result.action).toBe("inquiry_mismatch");
    expect(await balanceOf(userId)).toBe(0);
  });

  it("still credits a top-up whose own payment really did settle", async () => {
    const userId = await createUser();
    const topupCode = "WT-20260923-0004";
    await createPendingTopup(userId, topupCode, SETTLED_REF);

    const result = await handlePoppayCallback(
      callback(topupCode, SETTLED_REF, TOPUP_AMOUNT),
      callback(topupCode, SETTLED_REF, TOPUP_AMOUNT)
    );

    expect(result.action).toBe("completed_topup");
    expect(await balanceOf(userId)).toBe(TOPUP_AMOUNT);
  });
});
