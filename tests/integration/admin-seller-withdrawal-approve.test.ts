import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

const payoutCalls = vi.hoisted(() => ({ items: [] as Record<string, unknown>[] }));

vi.mock("@/lib/session", () => ({
  getSession: async () => sessionState.current,
}));

vi.mock("@/src/infra/payment/poppay/poppay.client", () => ({
  PoppayClient: class {
    async listBanks() {
      return {
        data: [
          { code: "014", name: "Bank Central Asia" },
          { code: "008", name: "Bank Mandiri" },
        ],
      };
    }
    async createOutgoing(input: Record<string, unknown>) {
      payoutCalls.items.push(input);
      return { refId: "ref-approve-1", aggregatorRefId: "agg-approve-1", raw: { ok: true } };
    }
  },
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { PATCH as approveWithdrawal } from "@/app/api/admin/seller-withdrawals/[id]/route";

async function createPendingWithdrawal(bankName: string) {
  const user = await prisma.user.create({
    data: {
      email: `approve-subject-${Date.now()}@example.test`,
      name: "Approve Subject",
      role: "MEMBER",
      wallet: { create: { balance: 0 } },
    },
  });

  return prisma.sellerWithdrawalRequest.create({
    data: {
      userId: user.id,
      amount: 75_000,
      status: "PENDING",
      accountName: "Approve Subject",
      accountNumber: "9876543210",
      bankName,
    },
  });
}

function patchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/admin/seller-withdrawals/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin approve withdrawal — bank code resolution", () => {
  beforeEach(async () => {
    await resetDatabase();
    payoutCalls.items = [];
    sessionState.current = { isLoggedIn: true, userId: "admin-1", role: "ADMIN" };
  });

  it("resolves the bank code from the bank name when none is supplied, then pays out", async () => {
    const request = await createPendingWithdrawal("Bank Central Asia");

    const response = await approveWithdrawal(
      patchRequest({ status: "APPROVED" }),
      { params: Promise.resolve({ id: request.id }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("APPROVED");
    expect(body.data.bankCode).toBe("014");
    expect(payoutCalls.items).toHaveLength(1);
    expect(payoutCalls.items[0]).toMatchObject({
      bankCode: "014",
      amount: 75000,
      destinationAccountNumber: "9876543210",
    });
  });

  it("trusts an explicit bankCode without looking it up", async () => {
    const request = await createPendingWithdrawal("Some Unlisted Bank");

    const response = await approveWithdrawal(
      patchRequest({ status: "APPROVED", bankCode: "999" }),
      { params: Promise.resolve({ id: request.id }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.bankCode).toBe("999");
    expect(payoutCalls.items[0]).toMatchObject({ bankCode: "999" });
  });

  it("fails the approval when the bank name cannot be matched", async () => {
    const request = await createPendingWithdrawal("Totally Unknown Bank");

    const response = await approveWithdrawal(
      patchRequest({ status: "APPROVED" }),
      { params: Promise.resolve({ id: request.id }) }
    );

    expect(response.status).toBe(400);
    expect(payoutCalls.items).toHaveLength(0);

    const stillPending = await prisma.sellerWithdrawalRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(stillPending.status).toBe("PENDING");
  });
  it("returns the held money to the merchant when the request is rejected", async () => {
    const withdrawal = await createPendingWithdrawal("Bank Central Asia");

    const res = await approveWithdrawal(
      patchRequest({ status: "REJECTED", processedNote: "Rekening tidak cocok" }),
      { params: Promise.resolve({ id: withdrawal.id }) }
    );

    expect(res.status).toBe(200);
    expect(payoutCalls.items).toHaveLength(0);

    const settled = await prisma.sellerWithdrawalRequest.findUniqueOrThrow({
      where: { id: withdrawal.id },
    });
    expect(settled.status).toBe("REJECTED");
    expect(settled.processedNote).toBe("Rekening tidak cocok");

    // The hold was taken at request time, so rejecting has to give it back.
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: withdrawal.userId },
    });
    expect(Number(wallet.balance)).toBe(75_000);

    const ledger = await prisma.ledgerEntry.findMany({
      where: { walletId: wallet.id, reference: withdrawal.id },
    });
    expect(ledger.map((e) => e.type)).toEqual(["WITHDRAW_RELEASE"]);
  });

  it("refuses to reject a payout already submitted to the gateway", async () => {
    const withdrawal = await createPendingWithdrawal("Bank Central Asia");
    await prisma.sellerWithdrawalRequest.update({
      where: { id: withdrawal.id },
      data: { status: "APPROVED" },
    });

    const res = await approveWithdrawal(
      patchRequest({ status: "REJECTED" }),
      { params: Promise.resolve({ id: withdrawal.id }) }
    );

    expect(res.status).toBe(400);

    // Money must not come back while it is on its way out.
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: withdrawal.userId },
    });
    expect(Number(wallet.balance)).toBe(0);
  });
});
