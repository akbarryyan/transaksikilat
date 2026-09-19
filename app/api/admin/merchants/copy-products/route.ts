import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin";
import { prisma } from "@/src/infra/db/prisma";

export const dynamic = "force-dynamic";

const CopyProductsSchema = z.object({
  sourceMerchantId: z.string().min(1),
  targetMerchantIds: z.array(z.string().min(1)).min(1),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminSession();
    if ("error" in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = CopyProductsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const sourceMerchant = await prisma.sellerProfile.findUnique({
      where: { id: parsed.data.sourceMerchantId },
      select: {
        id: true,
        displayName: true,
        userId: true,
      },
    });

    if (!sourceMerchant) {
      return NextResponse.json({ success: false, error: "Merchant sumber tidak ditemukan" }, { status: 404 });
    }

    const uniqueTargetIds = Array.from(new Set(parsed.data.targetMerchantIds)).filter(
      (id) => id !== parsed.data.sourceMerchantId
    );

    if (uniqueTargetIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "Pilih minimal satu merchant target yang berbeda dari merchant sumber" },
        { status: 400 }
      );
    }

    const targetMerchants = await prisma.sellerProfile.findMany({
      where: { id: { in: uniqueTargetIds } },
      select: {
        id: true,
        displayName: true,
        userId: true,
      },
    });

    if (targetMerchants.length === 0) {
      return NextResponse.json({ success: false, error: "Merchant target tidak ditemukan" }, { status: 404 });
    }

    const [sourceProducts, allSourceProductsCount] = await Promise.all([
      prisma.sellerProduct.findMany({
        where: { sellerId: sourceMerchant.userId, isActive: true },
        select: {
          productId: true,
          product: { select: { sellingPrice: true } },
        },
      }),
      prisma.sellerProduct.count({ where: { sellerId: sourceMerchant.userId } }),
    ]);

    if (sourceProducts.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: allSourceProductsCount > 0
            ? `Merchant sumber memiliki ${allSourceProductsCount} produk tetapi semuanya tidak aktif. Aktifkan dulu produk di dashboard merchant sebelum menyalin.`
            : "Merchant sumber belum memiliki produk untuk disalin.",
        },
        { status: 400 }
      );
    }

    const sourceProductIds = sourceProducts.map((item) => item.productId);

    const existingTargetProducts = await prisma.sellerProduct.findMany({
      where: {
        sellerId: { in: targetMerchants.map((item) => item.userId) },
        productId: { in: sourceProductIds },
      },
      select: {
        sellerId: true,
        productId: true,
      },
    });

    const existingKeys = new Set(
      existingTargetProducts.map((item) => `${item.sellerId}:${item.productId}`)
    );

    const payload: Array<{
      sellerId: string;
      productId: string;
      sellingPrice: number;
      isActive: boolean;
    }> = [];

    for (const target of targetMerchants) {
      for (const item of sourceProducts) {
        const key = `${target.userId}:${item.productId}`;
        if (existingKeys.has(key)) continue;
        payload.push({
          sellerId: target.userId,
          productId: item.productId,
          sellingPrice: Number(item.product.sellingPrice),
          isActive: true,
        });
      }
    }

    if (payload.length > 0) {
      await prisma.sellerProduct.createMany({
        data: payload,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        sourceMerchant: {
          id: sourceMerchant.id,
          displayName: sourceMerchant.displayName,
        },
        targetCount: targetMerchants.length,
        sourceProductCount: sourceProducts.length,
        createdCount: payload.length,
        skippedCount: targetMerchants.length * sourceProducts.length - payload.length,
      },
      message: "Produk aktif berhasil disalin ke merchant target",
    });
  } catch (error) {
    console.error("[POST /api/admin/merchants/copy-products]", error);
    return NextResponse.json({ success: false, error: "Gagal menyalin produk merchant" }, { status: 500 });
  }
}
