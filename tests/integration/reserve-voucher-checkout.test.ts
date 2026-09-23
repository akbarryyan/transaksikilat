import { beforeEach, describe, expect, it } from "vitest";

import { prisma, resetDatabase } from "@/tests/helpers/db";
import {
  reserveVoucherForCheckout,
  finalizeVoucherReservation,
  releaseVoucherReservation,
} from "@/src/core/services/checkout/reserve-voucher.service";

const BASE_AMOUNT = 100_000;

async function createVoucher(overrides: Partial<{
  quota: number | null;
  usedCount: number;
  perUserLimit: number;
  discountType: string;
  discountValue: number;
  minPurchase: number;
}> = {}) {
  return prisma.voucher.create({
    data: {
      code: `CHK-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase(),
      title: "Checkout Test Voucher",
      discountType: overrides.discountType ?? "FIXED",
      discountValue: overrides.discountValue ?? 10_000,
      minPurchase: overrides.minPurchase ?? 0,
      quota: overrides.quota === undefined ? 10 : overrides.quota,
      usedCount: overrides.usedCount ?? 0,
      perUserLimit: overrides.perUserLimit ?? 1,
    },
  });
}

async function createUsers(count: number): Promise<string[]> {
  const users = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      prisma.user.create({
        data: {
          email: `checkout-voucher-${Date.now()}-${i}-${Math.random()}@example.test`,
          name: `Checkout Voucher Subject ${i}`,
          role: "MEMBER",
        },
      })
    )
  );
  return users.map((u) => u.id);
}

describe("reserveVoucherForCheckout", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns no discount and no reservation when no code is given", async () => {
    const result = await reserveVoucherForCheckout(undefined, BASE_AMOUNT, null);
    expect(result).toEqual({ discountAmount: 0, reservation: null });
  });

  it("reserves a slot and computes the discount for a valid code", async () => {
    const voucher = await createVoucher({ discountValue: 15_000 });
    const [userId] = await createUsers(1);

    const result = await reserveVoucherForCheckout(voucher.code, BASE_AMOUNT, userId);

    expect(result.discountAmount).toBe(15_000);
    expect(result.reservation).toMatchObject({ voucherId: voucher.id, isNewReservation: true });
    expect(result.reservation?.claimId).not.toBeNull();

    const updated = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(updated.usedCount).toBe(1);

    const claim = await prisma.voucherClaim.findUniqueOrThrow({
      where: { id: result.reservation!.claimId! },
    });
    expect(claim.status).toBe("USED");
    expect(claim.userId).toBe(userId);
  });

  it("refuses a voucher on a checkout with nobody signed in", async () => {
    // Per-user limits are enforced through the claim row, and a guest has no
    // account to hang one on. Honouring the code anyway meant one person could
    // spend the same voucher until the quota ran out — or without limit when
    // the voucher has no quota. Voucher codes are public: /api/vouchers lists
    // every active one.
    const voucher = await createVoucher();

    const result = await reserveVoucherForCheckout(voucher.code, BASE_AMOUNT, null);

    expect(result.discountAmount).toBe(0);
    expect(result.reservation).toBeNull();

    const updated = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(updated.usedCount).toBe(0);
  });

  it("refuses an unlimited-quota voucher to a guest too", async () => {
    const voucher = await createVoucher({ quota: null });

    const result = await reserveVoucherForCheckout(voucher.code, BASE_AMOUNT, null);

    expect(result.discountAmount).toBe(0);
    expect(result.reservation).toBeNull();
  });

  it("caps a percentage discount at maxDiscount", async () => {
    const voucher = await prisma.voucher.create({
      data: {
        code: `PCT-${Date.now()}`.toUpperCase(),
        title: "Percent Voucher",
        discountType: "PERCENT",
        discountValue: 50,
        maxDiscount: 20_000,
        minPurchase: 0,
        quota: 10,
      },
    });

    const [userId] = await createUsers(1);

    const result = await reserveVoucherForCheckout(voucher.code, BASE_AMOUNT, userId);

    // 50% of 100_000 would be 50_000, capped at maxDiscount.
    expect(result.discountAmount).toBe(20_000);
  });

  it("refuses a checkout below minPurchase without reserving anything", async () => {
    const voucher = await createVoucher({ minPurchase: 200_000 });
    const [userId] = await createUsers(1);

    const result = await reserveVoucherForCheckout(voucher.code, BASE_AMOUNT, userId);

    expect(result).toEqual({ discountAmount: 0, reservation: null });
    const updated = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(updated.usedCount).toBe(0);
  });

  it("refuses a checkout once the quota is already exhausted", async () => {
    const voucher = await createVoucher({ quota: 3, usedCount: 3 });
    const [userId] = await createUsers(1);

    const result = await reserveVoucherForCheckout(voucher.code, BASE_AMOUNT, userId);

    expect(result).toEqual({ discountAmount: 0, reservation: null });
  });

  it("lets only one of many simultaneous checkouts take the last slot", async () => {
    const voucher = await createVoucher({ quota: 10, usedCount: 9 });
    const userIds = await createUsers(10);

    const results = await Promise.all(
      userIds.map((userId) => reserveVoucherForCheckout(voucher.code, BASE_AMOUNT, userId))
    );

    const reserved = results.filter((r) => r.reservation !== null);
    expect(reserved).toHaveLength(1);

    const updated = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(updated.usedCount).toBe(10);
  });

  it("reuses an existing CLAIMED voucher without touching the quota again", async () => {
    const voucher = await createVoucher({ quota: 5, usedCount: 1 });
    const [userId] = await createUsers(1);
    const existingClaim = await prisma.voucherClaim.create({
      data: { voucherId: voucher.id, userId, status: "CLAIMED" },
    });

    const result = await reserveVoucherForCheckout(voucher.code, BASE_AMOUNT, userId);

    expect(result.reservation).toMatchObject({
      isNewReservation: false,
      claimId: existingClaim.id,
    });
    expect(result.discountAmount).toBe(10_000);

    // Reusing an already-reserved slot must not increment usedCount again —
    // that slot was already counted when the claim was first created.
    const updated = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(updated.usedCount).toBe(1);
  });

  it("refuses a voucher the user has already used", async () => {
    const voucher = await createVoucher();
    const [userId] = await createUsers(1);
    await prisma.voucherClaim.create({
      data: { voucherId: voucher.id, userId, status: "USED" },
    });

    const result = await reserveVoucherForCheckout(voucher.code, BASE_AMOUNT, userId);

    expect(result).toEqual({ discountAmount: 0, reservation: null });
  });

  it("refuses a first-time claim when perUserLimit is 0", async () => {
    const voucher = await createVoucher({ perUserLimit: 0 });
    const [userId] = await createUsers(1);

    const result = await reserveVoucherForCheckout(voucher.code, BASE_AMOUNT, userId);

    expect(result).toEqual({ discountAmount: 0, reservation: null });
  });
});

describe("finalizeVoucherReservation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("attaches the order id to the reserved claim", async () => {
    const voucher = await createVoucher();
    const [userId] = await createUsers(1);
    const { reservation } = await reserveVoucherForCheckout(voucher.code, BASE_AMOUNT, userId);

    await finalizeVoucherReservation(reservation, "order-123");

    const claim = await prisma.voucherClaim.findUniqueOrThrow({
      where: { id: reservation!.claimId! },
    });
    expect(claim.orderId).toBe("order-123");
    expect(claim.status).toBe("USED");
  });

  it("does nothing when there is no reservation", async () => {
    await expect(finalizeVoucherReservation(null, "order-123")).resolves.toBeUndefined();
  });
});

describe("releaseVoucherReservation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns the slot and deletes the claim for a fresh reservation", async () => {
    const voucher = await createVoucher();
    const [userId] = await createUsers(1);
    const { reservation } = await reserveVoucherForCheckout(voucher.code, BASE_AMOUNT, userId);

    await releaseVoucherReservation(reservation);

    const updated = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(updated.usedCount).toBe(0);

    const claim = await prisma.voucherClaim.findUnique({ where: { id: reservation!.claimId! } });
    expect(claim).toBeNull();
  });

  it("leaves a reused reservation untouched", async () => {
    const voucher = await createVoucher({ usedCount: 1 });
    const [userId] = await createUsers(1);
    const existingClaim = await prisma.voucherClaim.create({
      data: { voucherId: voucher.id, userId, status: "CLAIMED" },
    });
    const { reservation } = await reserveVoucherForCheckout(voucher.code, BASE_AMOUNT, userId);

    await releaseVoucherReservation(reservation);

    // This reservation reused a slot claimed independently before checkout
    // ran — releasing it must not undo that earlier, unrelated claim.
    const updated = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(updated.usedCount).toBe(1);
    const claim = await prisma.voucherClaim.findUnique({ where: { id: existingClaim.id } });
    expect(claim).not.toBeNull();
  });

  it("does nothing when there is no reservation", async () => {
    await expect(releaseVoucherReservation(null)).resolves.toBeUndefined();
  });
});
