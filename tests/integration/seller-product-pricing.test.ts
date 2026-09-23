import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/lib/session", () => ({
  getSession: async () => sessionState.current,
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { invalidateSiteConfigCache } from "@/lib/site-config";
import { POST as saveSellerProduct } from "@/app/api/seller/products/route";

const PROVIDER_PRICE = 14_000;

async function createMerchant() {
  const user = await prisma.user.create({
    data: {
      email: `merchant-${Date.now()}-${Math.random()}@example.test`,
      name: "Merchant",
      role: "MEMBER",
    },
  });
  await prisma.sellerProfile.create({
    data: {
      userId: user.id,
      slug: `merchant-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      displayName: "Merchant",
      isActive: true,
    },
  });
  sessionState.current = { isLoggedIn: true, userId: user.id, role: "MEMBER" };
  return user;
}

async function createProduct() {
  return prisma.product.create({
    data: {
      provider: "DIGIFLAZZ",
      providerCode: `SKU-${Date.now()}-${Math.random()}`,
      name: "Diamond 100",
      category: "Games",
      brand: "Mobile Legends",
      type: "prepaid",
      providerPrice: PROVIDER_PRICE,
      sellingPrice: 16_000,
    },
  });
}

async function setPlatformFee(type: "PERCENT" | "FIXED", value: number) {
  await prisma.siteConfig.createMany({
    data: [
      { key: "MERCHANT_PLATFORM_FEE_TYPE", value: type },
      { key: "MERCHANT_PLATFORM_FEE_VALUE", value: String(value) },
    ],
  });
  invalidateSiteConfigCache();
}

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/seller/products", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("seller product pricing", () => {
  beforeEach(async () => {
    await resetDatabase();
    invalidateSiteConfigCache();
    sessionState.current = {};
  });

  it("ignores a platform fee dictated by the merchant", async () => {
    // The fee is the platform's cut of the merchant's margin. Letting the
    // merchant post it means they set what we earn.
    await setPlatformFee("PERCENT", 10);
    const merchant = await createMerchant();
    const product = await createProduct();

    const res = await saveSellerProduct(
      postRequest({
        productId: product.id,
        sellingPrice: 20_000,
        feeType: "FIXED",
        feeValue: 0,
      })
    );

    expect(res.status).toBe(200);
    const row = await prisma.sellerProduct.findFirstOrThrow({
      where: { sellerId: merchant.id, productId: product.id },
    });
    expect(row.feeType).toBe("PERCENT");
    expect(Number(row.feeValue)).toBe(10);
  });

  it("keeps the stored fee in step with the platform setting on update", async () => {
    await setPlatformFee("PERCENT", 10);
    const merchant = await createMerchant();
    const product = await createProduct();

    await saveSellerProduct(postRequest({ productId: product.id, sellingPrice: 20_000 }));
    await saveSellerProduct(
      postRequest({ productId: product.id, sellingPrice: 21_000, feeValue: 0, feeType: "FIXED" })
    );

    const row = await prisma.sellerProduct.findFirstOrThrow({
      where: { sellerId: merchant.id, productId: product.id },
    });
    expect(row.feeType).toBe("PERCENT");
    expect(Number(row.feeValue)).toBe(10);
    expect(Number(row.sellingPrice)).toBe(21_000);
  });

  it("refuses a price below what the provider charges us", async () => {
    // The other endpoint that writes this table already refuses it; both write
    // the same row and should agree.
    await createMerchant();
    const product = await createProduct();

    const res = await saveSellerProduct(
      postRequest({ productId: product.id, sellingPrice: PROVIDER_PRICE - 1 })
    );

    expect(res.status).toBe(422);
    expect(await prisma.sellerProduct.count()).toBe(0);
  });

  it("allows selling at exactly the provider price", async () => {
    await createMerchant();
    const product = await createProduct();

    const res = await saveSellerProduct(
      postRequest({ productId: product.id, sellingPrice: PROVIDER_PRICE })
    );

    expect(res.status).toBe(200);
  });
});
