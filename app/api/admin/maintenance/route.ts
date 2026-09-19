import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { getSiteConfig, setSiteConfig } from "@/lib/site-config";
import { cookies } from "next/headers";

const KEY = "MAINTENANCE_MODE";

export async function GET() {
  try {
    const val = await getSiteConfig(KEY);
    return NextResponse.json({ success: true, enabled: val === "1" });
  } catch (err) {
    console.error("[GET /api/admin/maintenance]", err);
    return NextResponse.json({ success: false, enabled: false }, { status: 500 });
  }
}

export async function PATCH() {
  try {
    const auth = await requireAdminSession();
    if ("error" in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const current = await getSiteConfig(KEY);
    const next = current === "1" ? "0" : "1";
    await setSiteConfig(KEY, next);

    // Set or clear the _maint cookie so middleware can read it cheaply
    const cookieStore = await cookies();
    if (next === "1") {
      cookieStore.set("_maint", "1", {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365, // 1 year
      });
    } else {
      cookieStore.set("_maint", "", {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: 0,
      });
    }

    return NextResponse.json({ success: true, enabled: next === "1" });
  } catch (err) {
    console.error("[PATCH /api/admin/maintenance]", err);
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}
