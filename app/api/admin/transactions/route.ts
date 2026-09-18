import { NextResponse } from "next/server";
import { prisma } from "@/src/infra/db/prisma";
import { requireAdminSession } from "@/lib/admin";
import {
  PENDING_STATUSES,
  UNPAGINATED_ROW_LIMIT,
} from "@/lib/admin-transactions";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/transactions
 * Get all transactions/orders with filters, stats, and optional pagination.
 * Add ?page=N&pageSize=M to enable server-side pagination.
 */
export async function GET(request: Request) {
  const auth = await requireAdminSession();
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  try {
    const { searchParams } = new URL(request.url);

    // Filters
    const status        = searchParams.get("status");
    const paymentMethod = searchParams.get("paymentMethod");
    const userType      = searchParams.get("userType"); // guest | member
    const search        = searchParams.get("search");
    const dateFrom      = searchParams.get("dateFrom");
    const dateTo        = searchParams.get("dateTo");

    // Pagination (optional)
    const pageParam     = searchParams.get("page");
    const pageSizeParam = searchParams.get("pageSize");
    const usePagination = pageParam !== null;
    const page          = Math.max(1, parseInt(pageParam     ?? "1",  10));
    const pageSize      = Math.max(1, parseInt(pageSizeParam ?? "10", 10));

    // Build where clause
    const where: any = {};

    if (status)        where.status        = status;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (userType === "guest")  where.userId = null;
    if (userType === "member") where.userId = { not: null };

    if (search) {
      where.OR = [
        { orderCode:    { contains: search } },
        { targetNumber: { contains: search } },
        { user: { name:  { contains: search } } },
        { user: { email: { contains: search } } },
        { user: { phone: { contains: search } } },
      ];
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo)   where.createdAt.lte = new Date(dateTo);
    }

    const include = {
      user: {
        select: { id: true, name: true, email: true, phone: true },
      },
      product: {
        select: { id: true, name: true, category: true, brand: true, provider: true },
      },
      paymentInvoice: {
        select: { id: true, invoiceId: true, gatewayName: true, status: true, paidAt: true },
      },
    };

    // Stats come from database aggregates over the whole filtered set, not
    // from the rows returned. Counting the returned rows made every figure
    // describe only the current page.
    const [orders, statusGroups, methodGroups, revenue, guestCount] =
      await Promise.all([
        prisma.order.findMany({
          where,
          include,
          orderBy: { createdAt: "desc" },
          skip: usePagination ? (page - 1) * pageSize : 0,
          take: usePagination ? pageSize : UNPAGINATED_ROW_LIMIT,
        }),
        prisma.order.groupBy({
          by: ["status"],
          where,
          _count: { _all: true },
        }),
        prisma.order.groupBy({
          by: ["paymentMethod"],
          where,
          _count: { _all: true },
        }),
        prisma.order.aggregate({
          where: { AND: [where, { status: "SUCCESS" }] },
          _sum: { amount: true },
        }),
        prisma.order.count({ where: { AND: [where, { userId: null }] } }),
      ]);

    const countByStatus = (statuses: string[]): number =>
      statusGroups
        .filter((group) => statuses.includes(group.status))
        .reduce((sum, group) => sum + group._count._all, 0);

    const total = statusGroups.reduce((sum, group) => sum + group._count._all, 0);

    const ordersData = orders.map((order) => ({
      id:            order.id,
      orderCode:     order.orderCode,
      userId:        order.userId,
      user:          order.user,
      product:       order.product,
      targetNumber:  order.targetNumber,
      targetData:    order.targetData,
      amount:        Number(order.amount),
      status:        order.status,
      paymentMethod: order.paymentMethod,
      serialNumber:  order.serialNumber,
      providerRef:   order.providerRef,
      notes:         order.notes,
      paymentInvoice: order.paymentInvoice,
      createdAt:     order.createdAt.toISOString(),
      updatedAt:     order.updatedAt.toISOString(),
    }));

    const countByMethod = (method: string): number =>
      methodGroups.find((group) => group.paymentMethod === method)?._count._all ?? 0;

    const stats = {
      total,
      success:      countByStatus(["SUCCESS"]),
      failed:       countByStatus(["FAILED"]),
      pending:      countByStatus(PENDING_STATUSES),
      totalRevenue: Number(revenue._sum.amount ?? 0),
      byPaymentMethod: {
        wallet:  countByMethod("WALLET"),
        gateway: countByMethod("PAYMENT_GATEWAY"),
      },
      byUserType: {
        guest:  guestCount,
        member: total - guestCount,
      },
    };

    return NextResponse.json({
      success: true,
      data:    ordersData,
      stats,
      ...(usePagination
        ? { total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
        : { total, truncated: total > UNPAGINATED_ROW_LIMIT }),
    });
  } catch (error) {
    console.error("Failed to get transactions:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}
