import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin";
import { prisma } from "@/src/infra/db/prisma";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  isActive: z.boolean(),
});

export async function PATCH(request: NextRequest) {
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

    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const result = await prisma.sellerProfile.updateMany({
      where: { id: { in: parsed.data.ids } },
      data: { isActive: parsed.data.isActive },
    });

    return NextResponse.json({
      success: true,
      data: {
        count: result.count,
        isActive: parsed.data.isActive,
      },
    });
  } catch (error) {
    console.error("[PATCH /api/admin/merchants/bulk]", error);
    return NextResponse.json({ success: false, error: "Gagal memperbarui merchant massal" }, { status: 500 });
  }
}
