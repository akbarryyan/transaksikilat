import { NextRequest, NextResponse } from "next/server";
import { ProviderManagementService } from "@/src/core/services/provider/provider-management.service";
import { ProviderType } from "@/src/core/domain/enums/provider.enum";
import { requireAdminSession } from "@/lib/admin";

const providerService = new ProviderManagementService();

/**
 * POST /api/admin/providers/[type]/sync-products
 * On-demand product sync for specific provider
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const auth = await requireAdminSession();
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  try {
    const { type } = await params;
    const provider = type.toUpperCase() as ProviderType;

    // Validate provider
    if (!Object.values(ProviderType).includes(provider)) {
      return NextResponse.json(
        { success: false, error: "Invalid provider type" },
        { status: 400 }
      );
    }

    // Sync products
    const result = await providerService.syncProviderProducts(provider);

    return NextResponse.json({
      success: true,
      data: {
        provider,
        syncedCount: result.length,
        products: result,
      },
    });
  } catch (error: any) {
    console.error("Sync products error:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || "Failed to sync products" 
      },
      { status: 500 }
    );
  }
}
