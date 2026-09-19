import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdminSession } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminSession();
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const rows = [
    {
      name: "Member Contoh",
      email: "member.contoh@example.com",
      phone: "081234567890",
      password: "Member123",
      tier: "Member",
      is_active: "true",
      role: "member",
      merchant_name: "",
      merchant_slug: "",
      merchant_description: "",
      merchant_is_active: "",
    },
    {
      name: "Merchant Contoh",
      email: "merchant.contoh@example.com",
      phone: "081234567891",
      password: "Merchant123",
      tier: "Reseller",
      is_active: "true",
      role: "merchant",
      merchant_name: "Toko Contoh",
      merchant_slug: "toko-contoh",
      merchant_description: "Merchant contoh hasil import excel",
      merchant_is_active: "true",
    },
  ];

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "members");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template-import-member-merchant.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
