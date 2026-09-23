import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/lib/session", () => ({
  getSession: async () => sessionState.current,
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import {
  GET as getTicket,
  POST as replyToTicket,
  PATCH as closeTicket,
} from "@/app/api/tickets/[id]/route";
import { GET as getTopup } from "@/app/api/wallet/topup/[id]/route";
import { GET as getMerchantOrder } from "@/app/api/merchant/orders/[id]/route";
import { POST as retryMerchantOrder } from "@/app/api/merchant/orders/[id]/retry/route";

function signIn(userId: string) {
  sessionState.current = { isLoggedIn: true, userId, role: "MEMBER" };
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function plainRequest(): NextRequest {
  return new NextRequest("http://localhost/api/x");
}

async function createUser(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}-${Date.now()}-${Math.random()}@example.test`,
      name: label,
      role: "MEMBER",
      wallet: { create: { balance: 0 } },
    },
  });
}

async function createMerchant(label: string) {
  const user = await createUser(label);
  await prisma.sellerProfile.create({
    data: {
      userId: user.id,
      slug: `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      displayName: label,
      isActive: true,
    },
  });
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
      providerPrice: 14_000,
      sellingPrice: 16_000,
    },
  });
}

describe("one account cannot reach another's records", () => {
  beforeEach(async () => {
    await resetDatabase();
    sessionState.current = {};
  });

  describe("support tickets", () => {
    async function createTicket(userId: string) {
      return prisma.ticket.create({
        data: {
          userId,
          subject: "Pesanan saya belum masuk",
          messages: {
            create: { senderRole: "USER", senderId: userId, body: "Tolong dicek" },
          },
        },
      });
    }

    it("hides a ticket from a signed-in stranger", async () => {
      const owner = await createUser("owner");
      const stranger = await createUser("stranger");
      const ticket = await createTicket(owner.id);

      signIn(stranger.id);
      const res = await getTicket(plainRequest(), params(ticket.id));

      expect(res.status).toBe(404);
    });

    it("refuses a stranger's reply on someone else's ticket", async () => {
      const owner = await createUser("owner");
      const stranger = await createUser("stranger");
      const ticket = await createTicket(owner.id);

      signIn(stranger.id);
      const res = await replyToTicket(jsonRequest({ message: "disusupi" }), params(ticket.id));

      expect(res.status).toBe(404);
      const messages = await prisma.ticketMessage.count({ where: { ticketId: ticket.id } });
      expect(messages).toBe(1);
    });

    it("refuses a stranger closing someone else's ticket", async () => {
      const owner = await createUser("owner");
      const stranger = await createUser("stranger");
      const ticket = await createTicket(owner.id);

      signIn(stranger.id);
      const res = await closeTicket(plainRequest(), params(ticket.id));

      expect(res.status).toBe(404);
      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(after.status).toBe("OPEN");
    });

    it("still lets the owner read their own ticket", async () => {
      const owner = await createUser("owner");
      const ticket = await createTicket(owner.id);

      signIn(owner.id);
      const res = await getTicket(plainRequest(), params(ticket.id));

      expect(res.status).toBe(200);
    });
  });

  describe("wallet top-ups", () => {
    async function createTopup(userId: string) {
      return prisma.walletTopup.create({
        data: {
          topupCode: `WT-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          userId,
          amount: 100_000,
          status: "PENDING",
          invoiceId: `inv-${Date.now()}-${Math.random()}`,
          paymentNumber: "00020101021226-QRIS-RAHASIA",
        },
      });
    }

    it("hides a top-up — and its payable QRIS — from a stranger", async () => {
      const owner = await createUser("owner");
      const stranger = await createUser("stranger");
      const topup = await createTopup(owner.id);

      signIn(stranger.id);
      const res = await getTopup(plainRequest(), params(topup.id));

      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("QRIS-RAHASIA");
    });

    it("still lets the owner poll their own top-up", async () => {
      const owner = await createUser("owner");
      const topup = await createTopup(owner.id);

      signIn(owner.id);
      const res = await getTopup(plainRequest(), params(topup.id));

      expect(res.status).toBe(200);
    });
  });

  describe("merchant orders", () => {
    async function createOrderForSeller(sellerId: string, status = "SUCCESS") {
      const product = await createProduct();
      return prisma.order.create({
        data: {
          orderCode: `WP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          productId: product.id,
          sellerId,
          provider: "DIGIFLAZZ",
          targetNumber: "081234567890",
          basePrice: 14_000,
          markup: 2_000,
          amount: 16_000,
          status,
          paymentMethod: "PAYMENT_GATEWAY",
          serialNumber: "SN-MERCHANT-RAHASIA",
        },
      });
    }

    it("hides another merchant's order, serial number included", async () => {
      const seller = await createMerchant("seller-a");
      const rival = await createMerchant("seller-b");
      const order = await createOrderForSeller(seller.id);

      signIn(rival.id);
      const res = await getMerchantOrder(plainRequest(), params(order.id));

      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("SN-MERCHANT-RAHASIA");
    });

    it("refuses a rival merchant retrying someone else's failed order", async () => {
      const seller = await createMerchant("seller-a");
      const rival = await createMerchant("seller-b");
      const order = await createOrderForSeller(seller.id, "FAILED");

      signIn(rival.id);
      const res = await retryMerchantOrder(jsonRequest(), params(order.id));

      expect(res.status).toBe(404);
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.status).toBe("FAILED");
    });

    it("refuses a member who never became a merchant", async () => {
      const seller = await createMerchant("seller-a");
      const member = await createUser("plain-member");
      const order = await createOrderForSeller(seller.id);

      signIn(member.id);
      const res = await getMerchantOrder(plainRequest(), params(order.id));

      expect(res.status).toBe(403);
    });

    it("still lets the merchant read their own order", async () => {
      const seller = await createMerchant("seller-a");
      const order = await createOrderForSeller(seller.id);

      signIn(seller.id);
      const res = await getMerchantOrder(plainRequest(), params(order.id));

      expect(res.status).toBe(200);
    });
  });
});
