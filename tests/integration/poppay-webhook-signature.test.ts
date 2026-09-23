import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/infra/payment/poppay/poppay.client", () => ({
  PoppayClient: class {
    async inquireIncoming() {
      return { status: "completed" };
    }
  },
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { invalidateSiteConfigCache } from "@/lib/site-config";
import { POST as poppayWebhook } from "@/app/api/webhook/poppay/route";

const SECRET = "poppay-test-secret";
const TOPUP_CODE = "WT-20260918-7001";
const AMOUNT = 25000;

async function seedStrictVerification(): Promise<void> {
  await prisma.siteConfig.createMany({
    data: [
      { key: "POPPAY_SECRET_KEY", value: SECRET },
      { key: "POPPAY_WEBHOOK_SIGNATURE_REQUIRED", value: "1" },
    ],
  });
  invalidateSiteConfigCache();
}

async function createPendingTopup(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `poppay-sig-${Date.now()}@example.test`,
      name: "Poppay Signature Subject",
      role: "MEMBER",
      wallet: { create: { balance: 0 } },
    },
  });

  // A pending top-up always carries the gateway reference it was created with —
  // that is the id settlement is verified against, and the checkout deletes the
  // row outright when the gateway never issued one.
  await prisma.walletTopup.create({
    data: {
      topupCode: TOPUP_CODE,
      userId: user.id,
      amount: AMOUNT,
      status: "PENDING",
      invoiceId: "poppay-ref-signature-test",
    },
  });

  return user.id;
}

function callbackBody(): string {
  return JSON.stringify({
    refid: "ref-signature-test",
    agg_refid: TOPUP_CODE,
    amount: AMOUNT,
    status: 5,
  });
}

function request(body: string, signature: string): Request {
  return new Request("http://localhost/api/webhook/poppay", {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": signature },
    body,
  });
}

async function outcome(userId: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  const topup = await prisma.walletTopup.findUniqueOrThrow({
    where: { topupCode: TOPUP_CODE },
  });
  return { balance: Number(wallet.balance), topupStatus: topup.status };
}

describe("poppay webhook signature enforcement", () => {
  beforeEach(async () => {
    await resetDatabase();
    invalidateSiteConfigCache();
  });

  it("refuses a callback with a bad signature while strict verification is on", async () => {
    const userId = await createPendingTopup();
    await seedStrictVerification();

    const response = await poppayWebhook(request(callbackBody(), "deadbeef"));

    expect(response.status).toBe(401);

    // The forged callback must not have moved money or settled the top-up.
    const state = await outcome(userId);
    expect(state.balance).toBe(0);
    expect(state.topupStatus).toBe("PENDING");
  });

  it("accepts a correctly signed callback while strict verification is on", async () => {
    const userId = await createPendingTopup();
    await seedStrictVerification();

    const body = callbackBody();
    const signature = createHmac("sha256", SECRET).update(body).digest("hex");

    const response = await poppayWebhook(request(body, signature));

    expect(response.status).toBe(200);

    const state = await outcome(userId);
    expect(state.balance).toBe(AMOUNT);
    expect(state.topupStatus).toBe("COMPLETED");
  });
});
