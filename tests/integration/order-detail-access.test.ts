import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const calls = vi.hoisted(() => ({ sync: [] as string[], reconcile: [] as string[] }));

vi.mock("@/lib/session", () => ({
  getSession: async () => sessionState.current,
}));

vi.mock("@/src/core/services/order/sync-expired-orders.service", () => ({
  syncExpiredOrderByCode: async (code: string) => {
    calls.sync.push(code);
    return 0;
  },
}));

vi.mock("@/src/core/services/provider/reconcile-scheduler.service", () => ({
  autoReconcileOrderNow: async (orderId: string) => {
    calls.reconcile.push(orderId);
    return null;
  },
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { GET } from "@/app/api/orders/[code]/route";

const SERIAL = "VOUCHER-RAHASIA-12345";
const TARGET = "081298765432";

async function createUser(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${label}-${Date.now()}-${Math.random()}@example.test`,
      name: label,
      role: "MEMBER",
    },
  });
  return user.id;
}

async function createOrder(opts: {
  orderCode: string;
  userId: string | null;
  viewToken?: string;
  status?: string;
}) {
  const product = await prisma.product.create({
    data: {
      provider: "DIGIFLAZZ",
      providerCode: `SKU-${Date.now()}-${Math.random()}`,
      name: "Diamond 100",
      category: "Games",
      brand: "Mobile Legends",
      type: "prepaid",
      providerPrice: 14000,
      sellingPrice: 16000,
    },
  });

  const order = await prisma.order.create({
    data: {
      orderCode: opts.orderCode,
      userId: opts.userId,
      productId: product.id,
      provider: "DIGIFLAZZ",
      targetNumber: TARGET,
      targetData: { zone: "1234" },
      basePrice: 14000,
      markup: 2000,
      fee: 500,
      amount: 16500,
      status: opts.status ?? "SUCCESS",
      paymentMethod: "PAYMENT_GATEWAY",
      serialNumber: SERIAL,
      viewTokenHash: opts.viewToken
        ? crypto.createHash("sha256").update(opts.viewToken).digest("hex")
        : null,
    },
  });

  await prisma.paymentInvoice.create({
    data: {
      orderId: order.id,
      gatewayName: "POPPAY",
      invoiceId: `inv-${Date.now()}-${Math.random()}`,
      amount: 16000,
      status: "PENDING",
      paymentUrl: "https://gateway.example/bayar/rahasia",
      paymentNumber: "00020101021226...",
    },
  });

  return order;
}

async function callGet(code: string, token?: string) {
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  const res = await GET(
    new Request(`http://localhost/api/orders/${encodeURIComponent(code)}${query}`),
    { params: Promise.resolve({ code }) }
  );
  return { status: res.status, body: await res.json() };
}

describe("order detail access control", () => {
  beforeEach(async () => {
    await resetDatabase();
    sessionState.current = {};
    calls.sync.length = 0;
    calls.reconcile.length = 0;
  });

  it("hides the serial number and target from a logged-in stranger", async () => {
    const owner = await createUser("owner");
    const stranger = await createUser("stranger");
    await createOrder({ orderCode: "WP-260923-AAA111", userId: owner });

    sessionState.current = { isLoggedIn: true, userId: stranger, role: "MEMBER" };
    const { status, body } = await callGet("WP-260923-AAA111");

    expect(status).toBe(200);
    expect(body.data.serialNumber).toBeUndefined();
    expect(body.data.targetNumber).toBeUndefined();
    expect(body.data.targetData).toBeUndefined();
    expect(body.data.paymentInvoice).toBeUndefined();
    // Status and product stay visible so order tracking keeps working.
    expect(body.data.status).toBe("SUCCESS");
    expect(body.data.product.name).toBe("Diamond 100");
  });

  it("hides the serial number and payment details from an anonymous lookup", async () => {
    const owner = await createUser("owner");
    await createOrder({ orderCode: "WP-260923-BBB222", userId: owner });

    const { status, body } = await callGet("WP-260923-BBB222");

    expect(status).toBe(200);
    expect(body.access).toBe("public");
    expect(body.data.serialNumber).toBeUndefined();
    expect(body.data.targetNumber).toBeUndefined();
    expect(body.data.paymentInvoice).toBeUndefined();
    expect(body.data.amount).toBeUndefined();
  });

  it("hides a guest order's details when no token is supplied", async () => {
    await createOrder({ orderCode: "WP-260923-CCC333", userId: null, viewToken: "rahasia" });

    const { status, body } = await callGet("WP-260923-CCC333");

    expect(status).toBe(200);
    expect(body.access).toBe("public");
    expect(body.data.serialNumber).toBeUndefined();
  });

  it("never returns cost price or markup, even to the owner", async () => {
    const owner = await createUser("owner");
    await createOrder({ orderCode: "WP-260923-DDD444", userId: owner });

    sessionState.current = { isLoggedIn: true, userId: owner, role: "MEMBER" };
    const { body } = await callGet("WP-260923-DDD444");

    expect(body.access).toBe("full");
    expect(body.data.basePrice).toBeUndefined();
    expect(body.data.markup).toBeUndefined();
  });

  it("returns the full order to its owner", async () => {
    const owner = await createUser("owner");
    await createOrder({ orderCode: "WP-260923-EEE555", userId: owner });

    sessionState.current = { isLoggedIn: true, userId: owner, role: "MEMBER" };
    const { body } = await callGet("WP-260923-EEE555");

    expect(body.access).toBe("full");
    expect(body.data.serialNumber).toBe(SERIAL);
    expect(body.data.targetNumber).toBe(TARGET);
    expect(body.data.paymentInvoice).not.toBeNull();
  });

  it("returns the full order to an admin", async () => {
    const owner = await createUser("owner");
    const admin = await createUser("admin");
    await createOrder({ orderCode: "WP-260923-FFF666", userId: owner });

    sessionState.current = { isLoggedIn: true, userId: admin, role: "ADMIN" };
    const { body } = await callGet("WP-260923-FFF666");

    expect(body.access).toBe("full");
    expect(body.data.serialNumber).toBe(SERIAL);
  });

  it("returns the full order to a guest holding the view token", async () => {
    await createOrder({ orderCode: "WP-260923-GGG777", userId: null, viewToken: "token-guest" });

    const { body } = await callGet("WP-260923-GGG777", "token-guest");

    expect(body.access).toBe("full");
    expect(body.data.serialNumber).toBe(SERIAL);
  });

  it("refuses a token that does not match", async () => {
    await createOrder({ orderCode: "WP-260923-HHH888", userId: null, viewToken: "token-benar" });

    const { status, body } = await callGet("WP-260923-HHH888", "token-salah");

    expect(status).toBe(403);
    expect(body.success).toBe(false);
  });

  it("does not call the provider for a lookup without access", async () => {
    const owner = await createUser("owner");
    await createOrder({ orderCode: "WP-260923-III999", userId: owner, status: "PAID" });

    await callGet("WP-260923-III999");

    expect(calls.reconcile).toHaveLength(0);
  });

  it("still reconciles an in-flight order for its owner", async () => {
    const owner = await createUser("owner");
    const order = await createOrder({
      orderCode: "WP-260923-JJJ000",
      userId: owner,
      status: "PAID",
    });

    sessionState.current = { isLoggedIn: true, userId: owner, role: "MEMBER" };
    await callGet("WP-260923-JJJ000");

    expect(calls.reconcile).toContain(order.id);
  });

  it("does not touch order state for a code it refuses", async () => {
    await createOrder({ orderCode: "WP-260923-KKK111", userId: null, viewToken: "token-benar" });

    await callGet("WP-260923-KKK111", "token-salah");

    expect(calls.sync).toHaveLength(0);
    expect(calls.reconcile).toHaveLength(0);
  });
});
