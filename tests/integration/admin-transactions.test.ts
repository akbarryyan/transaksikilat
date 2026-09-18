import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/lib/session", () => ({
  getSession: async () => sessionState.current,
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { GET as adminTransactions } from "@/app/api/admin/transactions/route";
import { UNPAGINATED_ROW_LIMIT } from "@/lib/admin-transactions";

const AMOUNT = 10000;

async function seedOrders(statuses: string[]): Promise<void> {
  const product = await prisma.product.create({
    data: {
      provider: "VIP_RESELLER",
      providerCode: `SKU-${Date.now()}`,
      name: "Test Product",
      category: "Games",
      brand: "Test Brand",
      type: "topup",
      providerPrice: 8000,
      sellingPrice: AMOUNT,
    },
  });

  await prisma.order.createMany({
    data: statuses.map((status, index) => ({
      orderCode: `WP-TEST-${Date.now()}-${index}`,
      productId: product.id,
      provider: "VIP_RESELLER",
      targetNumber: "081234567890",
      amount: AMOUNT,
      status,
      paymentMethod: "PAYMENT_GATEWAY",
    })),
  });
}

async function fetchTransactions(query: string) {
  const response = await adminTransactions(
    new Request(`http://localhost/api/admin/transactions${query}`)
  );
  return response.json();
}

describe("admin transactions listing", () => {
  beforeEach(async () => {
    await resetDatabase();
    sessionState.current = {
      isLoggedIn: true,
      userId: "admin-1",
      role: "ADMIN",
    };
  });

  it("reports stats for every matching order, not just the returned page", async () => {
    await seedOrders([
      ...Array(7).fill("SUCCESS"),
      ...Array(3).fill("FAILED"),
      ...Array(2).fill("PAID"),
    ]);

    const body = await fetchTransactions("?page=1&pageSize=5");

    expect(body.data).toHaveLength(5);
    expect(body.stats.total).toBe(12);
    expect(body.stats.success).toBe(7);
    expect(body.stats.failed).toBe(3);
    expect(body.stats.pending).toBe(2);
    expect(body.stats.totalRevenue).toBe(7 * AMOUNT);
  });

  it("caps how many rows an unpaginated request can pull", async () => {
    const count = UNPAGINATED_ROW_LIMIT + 1;
    await seedOrders(Array(count).fill("SUCCESS"));

    const body = await fetchTransactions("");

    // Without a cap this pulls the whole orders table, joins included.
    expect(body.data).toHaveLength(UNPAGINATED_ROW_LIMIT);
    expect(body.stats.total).toBe(count);
    expect(body.truncated).toBe(true);
  });
});
