import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/infra/db/prisma";
import { requireAdminSession } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brand-reviews
 * List all reviews (approved + pending) with optional filters.
 * Query: status=all|pending|approved, search, page
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminSession();
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") ?? "all";
  const search = searchParams.get("search")?.trim() ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const PAGE_SIZE = 20;

  const where = {
    ...(status === "pending" ? { isApproved: false } : status === "approved" ? { isApproved: true } : {}),
    ...(search
      ? {
          OR: [
            { brandSlug: { contains: search } },
            { userName: { contains: search } },
            { comment: { contains: search } },
          ],
        }
      : {}),
  };

  const [reviews, total] = await Promise.all([
    prisma.brandReview.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        brandSlug: true,
        userId: true,
        userName: true,
        rating: true,
        comment: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.brandReview.count({ where }),
  ]);

  return NextResponse.json({
    success: true,
    data: reviews,
    meta: { total, page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) },
  });
}

/**
 * PATCH /api/admin/brand-reviews
 * Approve or reject (delete) a review.
 * Body: { id, action: "approve" | "reject" }
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminSession();
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json();
  const { id, action } = body;

  if (!id || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ success: false, error: "Parameter tidak valid." }, { status: 400 });
  }

  if (action === "approve") {
    await prisma.brandReview.update({ where: { id }, data: { isApproved: true } });
    return NextResponse.json({ success: true, message: "Ulasan disetujui." });
  } else {
    await prisma.brandReview.delete({ where: { id } });
    return NextResponse.json({ success: true, message: "Ulasan dihapus." });
  }
}

/**
 * DELETE /api/admin/brand-reviews?id=xxx
 * Hard delete a review.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminSession();
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: "ID diperlukan." }, { status: 400 });

  await prisma.brandReview.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
