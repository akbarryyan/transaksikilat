import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { invalidateSiteConfigCache } from "@/lib/site-config";
import { POST as vipWebhook } from "@/app/api/webhook/vip/route";

const API_ID = "vip-test-api-id";
const API_KEY = "vip-test-api-key";
const TRX_ID = "vip-trx-9001";

const VALID_SIGNATURE = createHash("md5").update(API_ID + API_KEY).digest("hex");

async function enableStrictVerification(): Promise<void> {
  await prisma.siteConfig.create({
    data: { key: "VIP_WEBHOOK_SIGNATURE_REQUIRED", value: "1" },
  });
  invalidateSiteConfigCache();
}

async function createProcessingOrder(): Promise<string> {
  const product = await prisma.product.create({
    data: {
      provider: "VIP_RESELLER",
      providerCode: `SKU-${Date.now()}`,
      name: "Test Product",
      category: "Games",
      brand: "Test Brand",
      type: "topup",
      providerPrice: 10000,
      sellingPrice: 12000,
    },
  });

  const order = await prisma.order.create({
    data: {
      orderCode: `WP-TEST-${Date.now()}`,
      productId: product.id,
      provider: "VIP_RESELLER",
      targetNumber: "081234567890",
      amount: 12000,
      status: "PROCESSING_PROVIDER",
      paymentMethod: "PAYMENT_GATEWAY",
      providerRef: TRX_ID,
    },
  });

  return order.id;
}

function callback(signature?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== undefined) headers["x-client-signature"] = signature;

  return new Request("http://localhost/api/webhook/vip", {
    method: "POST",
    headers,
    body: JSON.stringify({
      result: true,
      data: [{ trxid: TRX_ID, status: "success", note: "SN-12345" }],
      message: "ok",
    }),
  });
}

async function statusOf(orderId: string): Promise<string> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  return order.status;
}

describe("vip webhook signature enforcement", () => {
  beforeEach(async () => {
    await resetDatabase();
    invalidateSiteConfigCache();
    process.env.VIP_API_ID = API_ID;
    process.env.VIP_API_KEY = API_KEY;
  });

  it("refuses an unsigned callback while strict verification is on", async () => {
    const orderId = await createProcessingOrder();
    await enableStrictVerification();

    // Omitting the header entirely used to skip verification altogether.
    const response = await vipWebhook(callback() as never);

    expect(response.status).toBe(401);
    expect(await statusOf(orderId)).toBe("PROCESSING_PROVIDER");
  });

  it("refuses a wrongly signed callback while strict verification is on", async () => {
    const orderId = await createProcessingOrder();
    await enableStrictVerification();

    const response = await vipWebhook(callback("not-the-right-signature") as never);

    expect(response.status).toBe(401);
    expect(await statusOf(orderId)).toBe("PROCESSING_PROVIDER");
  });

  it("processes a correctly signed callback while strict verification is on", async () => {
    const orderId = await createProcessingOrder();
    await enableStrictVerification();

    const response = await vipWebhook(callback(VALID_SIGNATURE) as never);

    expect(response.status).toBe(200);
    expect(await statusOf(orderId)).toBe("SUCCESS");
  });

  it("verifies against the credentials in site config rather than the environment", async () => {
    // Rotating a key in site config must take effect here, since that is where
    // the VIP adapter reads it from too.
    const rotatedKey = "vip-rotated-api-key";
    const orderId = await createProcessingOrder();
    await prisma.siteConfig.create({
      data: { key: "VIP_API_KEY", value: rotatedKey },
    });
    await enableStrictVerification();

    const staleSignature = VALID_SIGNATURE;
    expect(await vipWebhook(callback(staleSignature) as never)).toHaveProperty("status", 401);
    expect(await statusOf(orderId)).toBe("PROCESSING_PROVIDER");

    const rotatedSignature = createHash("md5").update(API_ID + rotatedKey).digest("hex");
    const response = await vipWebhook(callback(rotatedSignature) as never);

    expect(response.status).toBe(200);
    expect(await statusOf(orderId)).toBe("SUCCESS");
  });

  it("still processes an unsigned callback while strict verification is off", async () => {
    // Documents the staged rollout: the gap stays open until
    // VIP_WEBHOOK_SIGNATURE_REQUIRED is switched on in site config.
    const orderId = await createProcessingOrder();

    const response = await vipWebhook(callback() as never);

    expect(response.status).toBe(200);
    expect(await statusOf(orderId)).toBe("SUCCESS");
  });
});
