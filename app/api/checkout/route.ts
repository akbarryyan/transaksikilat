/**
 * POST /api/checkout
 *
 * Rule: Route handler only parses input, validates with Zod, calls service, returns response.
 * No business logic here — voucher validation is a lightweight lookup only.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { CreateCheckoutService } from "@/src/core/services/checkout/create-checkout.service";
import {
  reserveVoucherForCheckout,
  finalizeVoucherReservation,
  releaseVoucherReservation,
} from "@/src/core/services/checkout/reserve-voucher.service";
import { OrderRepository } from "@/src/infra/db/repositories/order.repository";
import { PoppayAdapter } from "@/src/infra/payment/poppay/poppay.adapter";
import { isPoppayConfigured } from "@/src/infra/payment/poppay/poppay.client";
import { getSession } from "@/lib/session";
import { prisma } from "@/src/infra/db/prisma";
import {
  ValidationError,
  GuestWalletError,
  InsufficientBalanceError,
  NotFoundError,
} from "@/src/core/domain/errors/domain.errors";
import { isLoginRequiredForPurchase } from "@/lib/auth-config";

export const dynamic = "force-dynamic";

const CheckoutSchema = z.object({
  productId: z.string().min(1),
  sellerProductId: z.string().min(1).optional(),
  targetNumber: z.string().min(1),
  targetData: z.record(z.string(), z.any()).optional(),
  whatsapp: z.string().max(20).optional(),
  paymentMethod: z.enum(["WALLET", "PAYMENT_GATEWAY"]),
  paymentGatewayMethod: z.string().optional(),
  redirectUrl: z.string().url().optional(),
  voucherCode: z.string().max(50).optional(),
});

export async function POST(request: Request) {
  // Declared outside the try block so the catch handler can release it if
  // checkout fails after the voucher's quota slot was already reserved.
  let voucherReservation: Awaited<ReturnType<typeof reserveVoucherForCheckout>>["reservation"] = null;

  try {
    // ── 1. Parse body ──────────────────────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    // ── 2. Validate ────────────────────────────────────────────────────────
    const parsed = CheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    // ── 3. Get user session (null for guest) ───────────────────────────────
    const session = await getSession();
    const userId = session.isLoggedIn && session.userId ? session.userId : null;

    if (await isLoginRequiredForPurchase() && !userId) {
      return NextResponse.json(
        { success: false, error: "Kamu harus login terlebih dahulu untuk melakukan pembelian." },
        { status: 401 }
      );
    }

    // ── 4. Payment gateway must be ready before anything gets reserved ──────
    // This check is a plain early return, not a thrown error, so it must run
    // before the voucher is reserved below — otherwise a reservation made
    // just before this returns would never reach the catch block that
    // releases it.
    if (parsed.data.paymentMethod === "PAYMENT_GATEWAY" && !(await isPoppayConfigured())) {
      return NextResponse.json(
        {
          success: false,
          error: "Poppay belum terkonfigurasi lengkap. Isi URL/API base, version, integrator token, aggregator code, dan merchant account number di Admin Settings.",
        },
        { status: 400 }
      );
    }

    // ── 5. Reserve voucher discount (lightweight — product price needed) ───
    // Reserving the quota slot now, before the order exists, is what closes
    // the race: two checkouts near the boundary can no longer both read the
    // same usedCount and both apply the discount.
    let baseAmount = 0;
    if (parsed.data.voucherCode) {
      const prod = await prisma.product.findUnique({ where: { id: parsed.data.productId } });
      if (prod) baseAmount = Number(prod.sellingPrice ?? 0);
    }
    const { discountAmount, reservation } = await reserveVoucherForCheckout(
      parsed.data.voucherCode,
      baseAmount,
      userId
    );
    voucherReservation = reservation;

    // ── 6. Buat Poppay adapter ─────────────────────────────────────────────
    const paymentGateway = new PoppayAdapter();

    // ── 7. Call service ────────────────────────────────────────────────────
    const checkoutService = new CreateCheckoutService(
      new OrderRepository(),
      paymentGateway,
    );

    const result = await checkoutService.execute({
      ...parsed.data,
      userId,
      voucherCode: discountAmount > 0 ? parsed.data.voucherCode : undefined,
      voucherDiscount: discountAmount,
    });

    // ── 8. Attach the order to the voucher claim (fire-and-forget) ─────────
    // Bookkeeping only at this point — the quota slot is already correctly
    // and atomically consumed, so this failing must not fail the order.
    if (voucherReservation) {
      finalizeVoucherReservation(voucherReservation, result.orderCode);
    }

    return NextResponse.json(
      { success: true, data: result, mode: "poppay" },
      { status: 201 }
    );
  } catch (err) {
    // The order was never placed — hand back any voucher slot this attempt
    // reserved so it isn't silently wasted on a checkout that never happened.
    await releaseVoucherReservation(voucherReservation);

    if (err instanceof ValidationError || err instanceof GuestWalletError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 404 });
    }
    if (err instanceof InsufficientBalanceError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 422 });
    }

    console.error("[POST /api/checkout]", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
