/**
 * POST /api/cron/reconcile-orders
 *
 * Sweeps orders left in PAID / PROCESSING_PROVIDER and asks the provider what
 * actually happened. Meant to be called by a scheduler on the host, because
 * the in-process retry timers do not survive a restart — and every deploy
 * restarts the container.
 */

import { NextResponse } from "next/server";
import { ReconcileOrderService } from "@/src/core/services/provider/reconcile-order.service";
import { OrderRepository } from "@/src/infra/db/repositories/order.repository";
import {
  isAuthorizedCronRequest,
  RECONCILE_BATCH_LIMIT,
  RECONCILE_STALE_MINUTES,
} from "@/lib/cron";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const service = new ReconcileOrderService(new OrderRepository());
    const result = await service.reconcileStaleOrders({
      olderThanMinutes: RECONCILE_STALE_MINUTES,
      limit: RECONCILE_BATCH_LIMIT,
    });

    if (result.scanned > 0) {
      console.log(
        `[Cron/Reconcile] scanned=${result.scanned} processed=${result.processed} errors=${result.errors}`
      );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("[Cron/Reconcile] Sweep failed:", error);
    return NextResponse.json(
      { success: false, error: "Reconcile sweep failed" },
      { status: 500 }
    );
  }
}
