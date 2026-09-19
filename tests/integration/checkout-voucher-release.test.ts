import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/lib/session", () => ({
  getSession: async () => sessionState.current,
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { POST as checkout } from "@/app/api/checkout/route";

async function createUserWithWallet(balance: number): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `checkout-release-${Date.now()}@example.test`,
      name: "Checkout Release Subject",
      role: "MEMBER",
      wallet: { create: { balance } },
    },
  });
  return user.id;
}

async function createProduct(sellingPrice: number) {
  return prisma.product.create({
    data: {
      provider: "VIP_RESELLER",
      providerCode: `SKU-${Date.now()}`,
      name: "Checkout Release Product",
      category: "Games",
      brand: "Test Brand",
      type: "topup",
      providerPrice: sellingPrice - 2000,
      sellingPrice,
    },
  });
}

async function createVoucher(quota: number, usedCount: number) {
  return prisma.voucher.create({
    data: {
      code: `RELEASE-${Date.now()}`.toUpperCase(),
      title: "Release Test Voucher",
      discountType: "FIXED",
      discountValue: 2000,
      quota,
      usedCount,
    },
  });
}

function checkoutRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("checkout releases a reserved voucher when the order fails", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns the voucher's last slot when a WALLET checkout fails for insufficient balance", async () => {
    // Zero balance guarantees CreateCheckoutService rejects before creating
    // an order — the failure this test needs, without mocking any provider.
    const userId = await createUserWithWallet(0);
    sessionState.current = { isLoggedIn: true, userId, role: "MEMBER" };
    const product = await createProduct(10_000);
    const voucher = await createVoucher(5, 4); // exactly one slot left

    const response = await checkout(
      checkoutRequest({
        productId: product.id,
        targetNumber: "081234567890",
        paymentMethod: "WALLET",
        voucherCode: voucher.code,
      })
    );
    const body = await response.json();

    expect(body.success).toBe(false);
    expect(response.status).toBe(422);

    const updatedVoucher = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(updatedVoucher.usedCount).toBe(4);

    const claimCount = await prisma.voucherClaim.count({ where: { voucherId: voucher.id, userId } });
    expect(claimCount).toBe(0);
  });

  it("does not reserve anything for a checkout that fails validation before the voucher step", async () => {
    const userId = await createUserWithWallet(0);
    sessionState.current = { isLoggedIn: true, userId, role: "MEMBER" };
    const voucher = await createVoucher(5, 4);

    // Missing targetNumber fails Zod validation, long before step 4/5.
    const response = await checkout(
      checkoutRequest({
        productId: "does-not-matter",
        paymentMethod: "WALLET",
        voucherCode: voucher.code,
      })
    );

    expect(response.status).toBe(422);
    const updatedVoucher = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(updatedVoucher.usedCount).toBe(4);
  });
});
