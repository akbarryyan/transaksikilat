/**
 * GET  /api/admin/site-config  — returns all site config values + effective provider modes
 * PATCH /api/admin/site-config — upsert one config key
 * DELETE /api/admin/site-config?key=... — reset key to env/default
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DEFAULT_HEADER_COLOR,
  getAllSiteConfig,
  setSiteConfig,
  deleteSiteConfig,
  getAllProviderModes,
  invalidateSiteConfigCache,
  normalizeHexColor,
} from "@/lib/site-config";
import { initProviderModesFromDB } from "@/src/infra/providers/provider.factory";
import { requireAdminSession } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Credentials the admin UI may overwrite but never read back. The browser
 * only learns whether each one is configured.
 */
const SECRET_KEYS = [
  "POPPAY_INTEGRATOR_TOKEN",
  "POPPAY_SECRET_KEY",
  "POPPAY_PASSWORD",
] as const;

function isSecretKey(key: string): boolean {
  return (SECRET_KEYS as readonly string[]).includes(key);
}

export async function GET() {
  const auth = await requireAdminSession();
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  // Sync in-memory ProviderFactory from DB on each admin page load
  await initProviderModesFromDB();

  const [raw, modes] = await Promise.all([
    getAllSiteConfig(),
    getAllProviderModes(),
  ]);

  const secretsConfigured = Object.fromEntries(
    SECRET_KEYS.map((key) => [key, Boolean(raw[key] || process.env[key])])
  );
  const safeRaw = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !isSecretKey(key))
  );

  return NextResponse.json({
    success: true,
    data: {
      raw: safeRaw, // raw key→value pairs, minus credentials
      secretsConfigured,
      modes,        // effective resolved modes (DB > env > default)
      envDefaults: {
        PROVIDER_DIGIFLAZZ_MODE: process.env.PROVIDER_DIGIFLAZZ_MODE ?? "mock",
        PROVIDER_VIP_MODE: process.env.PROVIDER_VIP_MODE ?? "mock",
        HEADER_COLOR: normalizeHexColor(process.env.HEADER_COLOR, DEFAULT_HEADER_COLOR),
        POPPAY_API_BASE_URL: process.env.POPPAY_API_BASE_URL ?? "",
        POPPAY_URL: process.env.POPPAY_URL ?? "",
        POPPAY_PORT: process.env.POPPAY_PORT ?? "",
        POPPAY_VERSION: process.env.POPPAY_VERSION ?? "",
        POPPAY_AGGREGATOR_CODE: process.env.POPPAY_AGGREGATOR_CODE ?? "",
        POPPAY_MERCHANT_ACCOUNT_NUMBER: process.env.POPPAY_MERCHANT_ACCOUNT_NUMBER ?? "",
        POPPAY_EMAIL: process.env.POPPAY_EMAIL ?? "",
        PAYMENT_GATEWAY_QRIS_FEE_TYPE: process.env.PAYMENT_GATEWAY_QRIS_FEE_TYPE ?? "FIXED",
        PAYMENT_GATEWAY_QRIS_FEE_VALUE: process.env.PAYMENT_GATEWAY_QRIS_FEE_VALUE ?? "0",
        MERCHANT_PLATFORM_FEE_TYPE: process.env.MERCHANT_PLATFORM_FEE_TYPE ?? "FIXED",
        MERCHANT_PLATFORM_FEE_VALUE: process.env.MERCHANT_PLATFORM_FEE_VALUE ?? "0",
        DIGIFLAZZ_USERNAME: process.env.DIGIFLAZZ_USERNAME ?? "",
        DIGIFLAZZ_API_KEY: process.env.DIGIFLAZZ_API_KEY ?? "",
        DIGIFLAZZ_BASE_URL: process.env.DIGIFLAZZ_BASE_URL ?? "https://api.digiflazz.com/v1",
        VIP_API_ID: process.env.VIP_API_ID ?? "",
        VIP_API_KEY: process.env.VIP_API_KEY ?? "",
        VIP_SIGN: process.env.VIP_SIGN ?? "",
        VIP_BASE_URL: process.env.VIP_BASE_URL ?? "https://vip-reseller.co.id/api",
      },
    },
  });
}

// site_configs.value is a MySQL TEXT column (65,535 bytes) and key is the
// primary key. Anything larger makes Prisma throw, which surfaced as a 500.
const MAX_VALUE_BYTES = 65_535;

const PatchSchema = z.object({
  key: z.string().min(1).max(191),
  value: z
    .string()
    .refine((v) => Buffer.byteLength(v, "utf8") <= MAX_VALUE_BYTES, {
      message: `value must be at most ${MAX_VALUE_BYTES} bytes`,
    }), // allow empty — empty value will delete the key (revert to .env default)
});

export async function PATCH(request: Request) {
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

  if (parsed.data.key === "HEADER_COLOR" && parsed.data.value !== "") {
    const normalized = normalizeHexColor(parsed.data.value, "");
    if (!normalized) {
      return NextResponse.json(
        { success: false, error: "HEADER_COLOR must use #RRGGBB format" },
        { status: 422 }
      );
    }
    parsed.data.value = normalized;
  }

  // If value is empty, delete the key so it falls back to .env default
  if (parsed.data.value === "") {
    await deleteSiteConfig(parsed.data.key);
  } else {
    await setSiteConfig(parsed.data.key, parsed.data.value);
  }

  // Also sync ProviderFactory globalThis so it takes effect immediately
  await initProviderModesFromDB();

  const modes = await getAllProviderModes();
  return NextResponse.json({ success: true, data: {
      key: parsed.data.key,
      // Never echo a credential back, even to the admin who just typed it.
      ...(isSecretKey(parsed.data.key) ? {} : { value: parsed.data.value }),
      modes,
    } });
}

export async function DELETE(request: Request) {
  const auth = await requireAdminSession();
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key) {
    return NextResponse.json({ success: false, error: "key is required" }, { status: 400 });
  }

  await deleteSiteConfig(key);
  invalidateSiteConfigCache();
  await initProviderModesFromDB();

  const modes = await getAllProviderModes();
  return NextResponse.json({ success: true, data: { key, modes } });
}
