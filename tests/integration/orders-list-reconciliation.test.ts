import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

const reconcileCalls = vi.hoisted(() => ({ orderIds: [] as string[] }));

vi.mock("@/lib/session", () => ({
  getSession: async () => sessionState.current,
}));

vi.mock("@/src/core/services/provider/reconcile-scheduler.service", () => ({
  autoReconcileOrderNow: vi.fn((orderId: string) => {
    reconcileCalls.orderIds.push(orderId);
    // Never resolves — a real provider call can hang or be slow, and the
    // list endpoint must not wait on it regardless.
    return new Promise(() => {});
  }),
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { GET as listOrders } from "@/app/api/orders/route";

async function createUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `orders-list-${Date.now()}-${Math.random()}@example.test`,
      name: "Orders List Subject",
      role: "MEMBER",
    },
  });
  return user.id;
}

async function createOrder(userId: string, status: string, index: number) {
  const product = await prisma.product.create({
    data: {
      provider: "VIP_RESELLER",
      providerCode: `SKU-${Date.now()}-${index}`,
      name: "Test Product",
      category: "Games",
      brand: "Test Brand",
      type: "topup",
      providerPrice: 8000,
      sellingPrice: 10000,
    },
  });

  return prisma.order.create({
    data: {
      orderCode: `WP-LIST-${Date.now()}-${index}`,
      userId,
      productId: product.id,
      provider: "VIP_RESELLER",
      targetNumber: "081234567890",
      amount: 10000,
      status,
      paymentMethod: "PAYMENT_GATEWAY",
    },
  });
}

function listRequest(): Request {
  return new Request("http://localhost/api/orders?limit=20");
}

describe("GET /api/orders reconciliation", () => {
  beforeEach(async () => {
    await resetDatabase();
    reconcileCalls.orderIds = [];
  });

  it("returns the page without waiting for reconciliation to finish", async () => {
    const userId = await createUser();
    sessionState.current = { isLoggedIn: true, userId, role: "MEMBER" };
    await createOrder(userId, "PROCESSING_PROVIDER", 0);

    // autoReconcileOrderNow above never resolves. If the route awaited it,
    // this call would hang until the test's own timeout — that's the
    // regression this test guards against, not something to catch with try/catch.
    const response = await listOrders(listRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(reconcileCalls.orderIds).toHaveLength(1);
  }, 5000);

  it("still returns each order's current database status, not a reconciled guess", async () => {
    const userId = await createUser();
    sessionState.current = { isLoggedIn: true, userId, role: "MEMBER" };
    const order = await createOrder(userId, "PAID", 0);

    const response = await listOrders(listRequest());
    const body = await response.json();

    expect(body.data[0].status).toBe("PAID");
    expect(body.data[0].orderCode).toBe(order.orderCode);
  }, 5000);

  it("caps reconciliation at 5 orders even with more in flight", async () => {
    const userId = await createUser();
    sessionState.current = { isLoggedIn: true, userId, role: "MEMBER" };
    for (let i = 0; i < 8; i += 1) {
      await createOrder(userId, "PROCESSING_PROVIDER", i);
    }

    const response = await listOrders(listRequest());

    expect(response.status).toBe(200);
    expect(reconcileCalls.orderIds).toHaveLength(5);
  }, 5000);

  it("does not attempt to reconcile orders that are already terminal", async () => {
    const userId = await createUser();
    sessionState.current = { isLoggedIn: true, userId, role: "MEMBER" };
    await createOrder(userId, "SUCCESS", 0);
    await createOrder(userId, "FAILED", 1);

    const response = await listOrders(listRequest());

    expect(response.status).toBe(200);
    expect(reconcileCalls.orderIds).toHaveLength(0);
  }, 5000);
});
