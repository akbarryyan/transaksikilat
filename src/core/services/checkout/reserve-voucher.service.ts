import type { Voucher } from "@prisma/client";
import { prisma } from "@/src/infra/db/prisma";

export interface VoucherReservation {
  voucherId: string;
  /** The claim row tied to this reservation. Null for a guest checkout —
   *  VoucherClaim.userId is required, so guests can never have one. */
  claimId: string | null;
  /**
   * True only when THIS call incremented usedCount (and, for a logged-in
   * user, created the claim row). A reused pre-existing CLAIMED row's quota
   * slot was consumed independently, before this checkout ran, so releasing
   * *this* reservation must never touch it.
   */
  isNewReservation: boolean;
}

export interface VoucherReservationResult {
  discountAmount: number;
  reservation: VoucherReservation | null;
}

const NO_DISCOUNT: VoucherReservationResult = { discountAmount: 0, reservation: null };

function computeDiscount(
  voucher: Pick<Voucher, "discountType" | "discountValue" | "maxDiscount">,
  baseAmount: number
): number {
  let discountAmount =
    voucher.discountType === "FIXED"
      ? Number(voucher.discountValue)
      : Math.floor((baseAmount * Number(voucher.discountValue)) / 100);

  if (voucher.discountType !== "FIXED" && voucher.maxDiscount !== null) {
    discountAmount = Math.min(discountAmount, Number(voucher.maxDiscount));
  }

  return Math.min(discountAmount, baseAmount - 1);
}

/**
 * Reserves a voucher's quota slot for a checkout that is about to apply its
 * discount to an order amount — before that happens, not after. Checking
 * usedCount against quota and incrementing it later (once the order already
 * exists) let two concurrent checkouts near the boundary both read the same
 * usedCount, both apply the discount, and both increment: two customers
 * charged a discounted price the voucher was never meant to cover twice.
 *
 * The reservation this returns must be finalized (on checkout success) or
 * released (on checkout failure) by the caller — see below.
 */
export async function reserveVoucherForCheckout(
  code: string | undefined,
  baseAmount: number,
  userId: string | null
): Promise<VoucherReservationResult> {
  if (!code) return NO_DISCOUNT;

  const voucher = await prisma.voucher.findUnique({ where: { code: code.toUpperCase() } });
  if (!voucher || !voucher.isActive) return NO_DISCOUNT;

  const now = new Date();
  if (voucher.startDate && now < voucher.startDate) return NO_DISCOUNT;
  if (voucher.endDate && now > voucher.endDate) return NO_DISCOUNT;
  if (baseAmount < Number(voucher.minPurchase)) return NO_DISCOUNT;

  if (userId) {
    const existing = await prisma.voucherClaim.findUnique({
      where: { voucherId_userId: { voucherId: voucher.id, userId } },
    });
    if (existing) {
      if (existing.status === "USED") return NO_DISCOUNT;
      // The slot was already reserved earlier (e.g. via /vouchers/claim) —
      // there is nothing left to reserve now, only to reuse.
      return {
        discountAmount: computeDiscount(voucher, baseAmount),
        reservation: { voucherId: voucher.id, claimId: existing.id, isNewReservation: false },
      };
    }
    if (voucher.perUserLimit <= 0) return NO_DISCOUNT;
  }

  // Claiming the slot is a single conditional UPDATE, guarded on the
  // usedCount MySQL still holds at write time — not the value read above,
  // which several simultaneous checkouts would otherwise share.
  const reservation = await prisma.$transaction(async (tx) => {
    const claimed = await tx.voucher.updateMany({
      where: {
        id: voucher.id,
        OR: [{ quota: null }, { usedCount: { lt: voucher.quota ?? 0 } }],
      },
      data: { usedCount: { increment: 1 } },
    });
    if (claimed.count === 0) return null;

    let claimId: string | null = null;
    if (userId) {
      const claim = await tx.voucherClaim.create({
        data: { voucherId: voucher.id, userId, status: "USED", usedAt: new Date() },
      });
      claimId = claim.id;
    }
    return { voucherId: voucher.id, claimId, isNewReservation: true };
  });

  if (!reservation) return NO_DISCOUNT;

  return { discountAmount: computeDiscount(voucher, baseAmount), reservation };
}

/** Called once the order the reservation was made for has been created. */
export async function finalizeVoucherReservation(
  reservation: VoucherReservation | null,
  orderId: string
): Promise<void> {
  if (!reservation?.claimId) return;

  try {
    await prisma.voucherClaim.update({
      where: { id: reservation.claimId },
      data: { status: "USED", usedAt: new Date(), orderId },
    });
  } catch (err) {
    // Bookkeeping only at this point — the quota slot is already correctly
    // consumed, so a failure here must not fail the order.
    console.error("[reserveVoucherForCheckout] Failed to finalize reservation:", err);
  }
}

/**
 * Called when the checkout that reserved this slot ultimately fails, so the
 * voucher isn't silently wasted on an order that was never actually placed.
 * A no-op for a reused pre-existing claim — that slot's lifecycle belongs to
 * whenever it was originally claimed, not to this checkout attempt.
 */
export async function releaseVoucherReservation(
  reservation: VoucherReservation | null
): Promise<void> {
  if (!reservation?.isNewReservation) return;

  try {
    await prisma.$transaction(async (tx) => {
      if (reservation.claimId) {
        await tx.voucherClaim.delete({ where: { id: reservation.claimId } });
      }
      await tx.voucher.update({
        where: { id: reservation.voucherId },
        data: { usedCount: { decrement: 1 } },
      });
    });
  } catch (err) {
    console.error("[reserveVoucherForCheckout] Failed to release reservation:", err);
  }
}
