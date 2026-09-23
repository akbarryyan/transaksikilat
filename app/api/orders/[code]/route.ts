/**
 * GET /api/orders/[code]?token=<viewToken>
 *
 * Two access levels, decided before anything is returned:
 *
 * - full   — the owner, an admin, or a guest presenting the order's view token.
 *            Gets the whole order, serial number included.
 * - public — anyone else who knows the code. Gets progress only, so the
 *            "lacak pesanan" form keeps working without handing a stranger the
 *            goods, the buyer's target number, or a still-payable invoice.
 *
 * An order code is not a credential: it travels in URLs, referrers, browser
 * history and support chats, and its random part is small enough to sweep. It
 * may reveal where an order stands; it must not unlock what was bought.
 *
 * Rule: No business logic — parse/validate/query/respond.
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import { OrderRepository } from "@/src/infra/db/repositories/order.repository";
import { getSession } from "@/lib/session";
import { syncExpiredOrderByCode } from "@/src/core/services/order/sync-expired-orders.service";
import { autoReconcileOrderNow } from "@/src/core/services/provider/reconcile-scheduler.service";

export const dynamic = "force-dynamic";

const orderRepo = new OrderRepository();

type Order = NonNullable<Awaited<ReturnType<OrderRepository["findByCode"]>>>;
type Access = "full" | "public" | "forbidden";

interface SessionShape {
  isLoggedIn?: boolean;
  userId?: string;
  role?: string;
}

function tokenMatches(rawToken: string, viewTokenHash: string | null): boolean {
  if (!viewTokenHash) return false;
  const presented = crypto.createHash("sha256").update(rawToken).digest("hex");
  return presented === viewTokenHash;
}

/**
 * A presented token that does not match is refused outright rather than
 * quietly downgraded: someone holding a token is following a deep link, and a
 * silent fallback to the public view would read as "your order vanished".
 */
function resolveAccess(order: Order, session: SessionShape, rawToken: string | null): Access {
  const sessionUserId = session.isLoggedIn ? session.userId : undefined;

  if (sessionUserId && session.role === "ADMIN") return "full";
  if (sessionUserId && order.userId && sessionUserId === order.userId) return "full";
  if (rawToken) return tokenMatches(rawToken, order.viewTokenHash) ? "full" : "forbidden";

  return "public";
}

function publicPayload(order: Order) {
  return {
    orderCode: order.orderCode,
    status: order.status,
    product: {
      name: order.product.name,
      category: order.product.category,
      brand: order.product.brand,
    },
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/** basePrice and markup stay out: that is our cost and margin, not the buyer's business. */
function fullPayload(order: Order) {
  return {
    ...publicPayload(order),
    targetNumber: order.targetNumber,
    targetData: order.targetData,
    notes: order.notes ?? null,
    amount: Number(order.amount),
    fee: Number(order.fee),
    paymentMethod: order.paymentMethod,
    serialNumber: order.serialNumber ?? null,
    paymentInvoice: order.paymentInvoice
      ? {
          status: order.paymentInvoice.status,
          paymentUrl: order.paymentInvoice.paymentUrl,
          paymentNumber: order.paymentInvoice.paymentNumber,
          method: order.paymentInvoice.method,
          expiredAt: order.paymentInvoice.expiredAt,
          paidAt: order.paymentInvoice.paidAt,
        }
      : null,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const { searchParams } = new URL(request.url);
    const rawToken = searchParams.get("token");

    let order = await orderRepo.findByCode(code);

    if (!order) {
      return NextResponse.json({ success: false, error: "Order not found" }, { status: 404 });
    }

    // ── Access control, before any state is touched ────────────────────────
    const session = await getSession();
    const access = resolveAccess(order, session, rawToken);

    if (access === "forbidden") {
      return NextResponse.json({ success: false, error: "Invalid token" }, { status: 403 });
    }

    // Expiring a stale invoice is a write, so it waits until the caller has
    // been let in — a code we refuse must leave no trace.
    if (await syncExpiredOrderByCode(code)) {
      order = (await orderRepo.findByCode(code)) ?? order;
    }

    // Reconciling calls the provider. Only someone entitled to the order's
    // contents may spend that call, otherwise a stranger sweeping codes drives
    // outbound traffic on every hit.
    if (
      access === "full" &&
      (order.status === "PAID" || order.status === "PROCESSING_PROVIDER")
    ) {
      const reconciled = await autoReconcileOrderNow(order.id);
      if (reconciled) {
        order = reconciled;
      }
    }

    return NextResponse.json({
      success: true,
      access,
      data: access === "full" ? fullPayload(order) : publicPayload(order),
    });
  } catch (err) {
    console.error("[GET /api/orders/[code]]", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
