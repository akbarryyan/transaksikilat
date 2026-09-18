import { beforeEach, describe, expect, it } from "vitest";

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { POST as reconcileCron } from "@/app/api/cron/reconcile-orders/route";
import { RECONCILE_BATCH_LIMIT } from "@/lib/cron";

const SECRET = "cron-test-secret";

async function seedStaleOrders(count: number): Promise<void> {
  const product = await prisma.product.create({
    data: {
      provider: "VIP_RESELLER",
      providerCode: `SKU-${Date.now()}`,
      name: "Test Product",
      category: "Games",
      brand: "Test Brand",
      type: "topup",
      providerPrice: 8000,
      sellingPrice: 10000,
    },
  });

  // updatedAt older than the staleness cutoff, which is what marks an order as
  // needing a second look.
  const stale = new Date(Date.now() - 60 * 60 * 1000);

  await prisma.order.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      orderCode: `WP-STALE-${Date.now()}-${index}`,
      productId: product.id,
      provider: "VIP_RESELLER",
      targetNumber: "081234567890",
      amount: 10000,
      status: "PROCESSING_PROVIDER",
      paymentMethod: "PAYMENT_GATEWAY",
      createdAt: stale,
      updatedAt: stale,
    })),
  });
}

function request(secret?: string): Request {
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers.authorization = `Bearer ${secret}`;

  return new Request("http://localhost/api/cron/reconcile-orders", {
    method: "POST",
    headers,
  });
}

describe("reconcile cron endpoint", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.CRON_SECRET = SECRET;
  });

  it("refuses a request with no credentials", async () => {
    const response = await reconcileCron(request());
    expect(response.status).toBe(401);
  });

  it("refuses a request bearing the wrong secret", async () => {
    const response = await reconcileCron(request("not-the-secret"));
    expect(response.status).toBe(401);
  });

  it("refuses every request while CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const response = await reconcileCron(request("anything"));
    expect(response.status).toBe(401);
  });

  it("picks up stale orders when the secret matches", async () => {
    await seedStaleOrders(3);

    const response = await reconcileCron(request(SECRET));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.scanned).toBe(3);
  });

  it("never takes more than one batch in a single run", async () => {
    await seedStaleOrders(RECONCILE_BATCH_LIMIT + 5);

    const response = await reconcileCron(request(SECRET));
    const body = await response.json();

    // An unbounded sweep would hit the provider once per stuck order and time
    // out, leaving the backlog half-processed.
    expect(body.data.scanned).toBe(RECONCILE_BATCH_LIMIT);
  });
});
