/**
 * POST /api/vouchers/claim  — claim a voucher by code
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/src/infra/db/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || !session.userId) {
      return NextResponse.json({ success: false, error: "Login diperlukan." }, { status: 401 });
    }
    const userId = session.userId;

    const body = await request.json().catch(() => ({}));
    const code = (body?.code ?? "").toString().trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ success: false, error: "Kode voucher wajib diisi." }, { status: 400 });
    }

    const now = new Date();
    const voucher = await prisma.voucher.findUnique({ where: { code } });

    if (!voucher) {
      return NextResponse.json({ success: false, error: "Kode voucher tidak ditemukan." }, { status: 404 });
    }
    if (!voucher.isActive) {
      return NextResponse.json({ success: false, error: "Voucher tidak aktif." }, { status: 400 });
    }
    if (voucher.startDate && voucher.startDate > now) {
      return NextResponse.json({ success: false, error: "Voucher belum bisa digunakan." }, { status: 400 });
    }
    if (voucher.endDate && voucher.endDate < now) {
      return NextResponse.json({ success: false, error: "Voucher sudah kadaluarsa." }, { status: 400 });
    }
    if (voucher.quota !== null && voucher.usedCount >= voucher.quota) {
      return NextResponse.json({ success: false, error: "Kuota voucher sudah habis." }, { status: 400 });
    }

    // Check user claim count
    const userClaimCount = await prisma.voucherClaim.count({
      where: { voucherId: voucher.id, userId },
    });
    if (userClaimCount >= voucher.perUserLimit) {
      return NextResponse.json({ success: false, error: "Kamu sudah mengklaim voucher ini." }, { status: 400 });
    }

    // Claiming the quota slot is a single conditional UPDATE, guarded on the
    // usedCount MySQL still holds at write time — not the value read above,
    // which several simultaneous requests would otherwise share. Checking
    // usedCount and incrementing it as two separate steps let concurrent
    // claims near the boundary all pass the check and all increment,
    // oversubscribing a limited voucher.
    const claim = await prisma.$transaction(async (tx) => {
      const claimed = await tx.voucher.updateMany({
        where: {
          id: voucher.id,
          OR: [{ quota: null }, { usedCount: { lt: voucher.quota ?? 0 } }],
        },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count === 0) return null;

      return tx.voucherClaim.create({
        data: {
          voucherId: voucher.id,
          userId,
          status: "CLAIMED",
        },
      });
    });

    if (!claim) {
      return NextResponse.json({ success: false, error: "Kuota voucher sudah habis." }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: "Voucher berhasil diklaim!",
      data: {
        claimId: claim.id,
        code: voucher.code,
        title: voucher.title,
        discountType: voucher.discountType,
        discountValue: Number(voucher.discountValue),
        maxDiscount: voucher.maxDiscount ? Number(voucher.maxDiscount) : null,
        minPurchase: Number(voucher.minPurchase),
        endDate: voucher.endDate,
      },
    });
  } catch (err: unknown) {
    // Unique constraint: already claimed
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ success: false, error: "Kamu sudah mengklaim voucher ini." }, { status: 400 });
    }
    console.error("[POST /api/vouchers/claim]", err);
    return NextResponse.json({ success: false, error: "Gagal mengklaim voucher." }, { status: 500 });
  }
}
