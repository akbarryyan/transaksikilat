import { beforeEach, describe, expect, it } from "vitest";

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { CreateWithdrawalService } from "@/src/core/services/withdrawal/create-withdrawal.service";
import { SellerWithdrawalRepository } from "@/src/infra/db/repositories/seller-withdrawal.repository";
import { InsufficientBalanceError } from "@/src/core/domain/errors/domain.errors";
import type {
  IPayoutGatewayPort,
  PayoutInput,
  PayoutResult,
} from "@/src/core/ports/payout-gateway.port";

const AMOUNT = 50_000;

class FakePayoutGateway implements IPayoutGatewayPort {
  readonly gatewayName = "FAKE";
  calls: PayoutInput[] = [];
  bankCodeToReturn = "014";
  bankCodeError: string | null = null;
  outgoingError: string | null = null;

  async resolveBankCode(explicitBankCode: string | null | undefined): Promise<string> {
    if (this.bankCodeError) throw new Error(this.bankCodeError);
    return explicitBankCode?.trim() || this.bankCodeToReturn;
  }

  async createOutgoing(input: PayoutInput): Promise<PayoutResult> {
    this.calls.push(input);
    if (this.outgoingError) throw new Error(this.outgoingError);
    return { refId: "ref-fake-1", aggregatorRefId: "agg-fake-1", raw: { ok: true } };
  }
}

async function createSeller(balance: number): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `withdraw-service-${Date.now()}-${Math.random()}@example.test`,
      name: "Withdraw Service Subject",
      role: "MEMBER",
      wallet: { create: { balance } },
    },
  });
  return user.id;
}

function withdrawalInput(userId: string, overrides: Partial<{ amount: number }> = {}) {
  return {
    userId,
    amount: overrides.amount ?? AMOUNT,
    bankCode: "014",
    accountName: "Withdraw Subject",
    accountNumber: "1234567890",
    bankName: "BCA",
  };
}

/**
 * A seller whose first payout has already been through admin review. Until that
 * has happened once, a withdrawal is held rather than paid out, so every test
 * about the automatic path needs this first.
 */
async function seedReviewedWithdrawal(userId: string) {
  await prisma.sellerWithdrawalRequest.create({
    data: {
      userId,
      amount: 1_000,
      status: "PAID",
      accountName: "Withdraw Subject",
      accountNumber: "1234567890",
      bankName: "BCA",
      payoutGateway: "FAKE",
    },
  });
}

describe("CreateWithdrawalService", () => {
  let gateway: FakePayoutGateway;
  let service: CreateWithdrawalService;

  beforeEach(async () => {
    await resetDatabase();
    gateway = new FakePayoutGateway();
    service = new CreateWithdrawalService(new SellerWithdrawalRepository(), gateway);
  });

  it("debits the wallet, submits the payout, and approves the request", async () => {
    const userId = await createSeller(AMOUNT);
    await seedReviewedWithdrawal(userId);

    const result = await service.execute(withdrawalInput(userId));

    expect(result.status).toBe("APPROVED");
    expect(Number(result.amount)).toBe(AMOUNT);
    expect(result.payoutRefId).toBe("ref-fake-1");
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]).toMatchObject({
      amount: AMOUNT,
      bankCode: "014",
      destinationAccountNumber: "1234567890",
      destinationAccountName: "Withdraw Subject",
    });

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(Number(wallet.balance)).toBe(0);

    const ledger = await prisma.ledgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "asc" },
    });
    expect(ledger.map((e) => e.type)).toEqual(["WITHDRAW_HOLD"]);
  });

  it("refuses a withdrawal larger than the balance without touching the wallet or calling the gateway", async () => {
    const userId = await createSeller(AMOUNT - 1);

    await expect(service.execute(withdrawalInput(userId))).rejects.toThrow(
      InsufficientBalanceError
    );

    expect(gateway.calls).toHaveLength(0);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(Number(wallet.balance)).toBe(AMOUNT - 1);

    const requestCount = await prisma.sellerWithdrawalRequest.count({ where: { userId } });
    expect(requestCount).toBe(0);
  });

  it("returns the money and rejects the request when the payout fails", async () => {
    const userId = await createSeller(AMOUNT);
    await seedReviewedWithdrawal(userId);
    gateway.outgoingError = "Poppay down";

    await expect(service.execute(withdrawalInput(userId))).rejects.toThrow("Poppay down");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(Number(wallet.balance)).toBe(AMOUNT);

    // The seller also has the reviewed request seeded above; this is the new one.
    const request = await prisma.sellerWithdrawalRequest.findFirstOrThrow({
      where: { userId, NOT: { status: "PAID" } },
    });
    expect(request.status).toBe("REJECTED");
    expect(request.processedNote).toContain("Poppay down");

    const ledger = await prisma.ledgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "asc" },
    });
    expect(ledger.map((e) => e.type)).toEqual(["WITHDRAW_HOLD", "WITHDRAW_RELEASE"]);
  });

  it("returns the money and rejects the request when bank code resolution fails", async () => {
    const userId = await createSeller(AMOUNT);
    await seedReviewedWithdrawal(userId);
    gateway.bankCodeError = "Kode bank tidak ditemukan";

    await expect(service.execute(withdrawalInput(userId))).rejects.toThrow(
      "Kode bank tidak ditemukan"
    );

    expect(gateway.calls).toHaveLength(0);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(Number(wallet.balance)).toBe(AMOUNT);

    // The seller also has the reviewed request seeded above; this is the new one.
    const request = await prisma.sellerWithdrawalRequest.findFirstOrThrow({
      where: { userId, NOT: { status: "PAID" } },
    });
    expect(request.status).toBe("REJECTED");
  });

  it("creates a wallet on the fly for a seller who never had one", async () => {
    const user = await prisma.user.create({
      data: {
        email: `no-wallet-${Date.now()}@example.test`,
        name: "No Wallet Subject",
        role: "MEMBER",
      },
    });

    await expect(service.execute(withdrawalInput(user.id))).rejects.toThrow(
      InsufficientBalanceError
    );

    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    expect(wallet).not.toBeNull();
    expect(Number(wallet!.balance)).toBe(0);
  });
  it("holds a seller's first payout for review instead of sending the money", async () => {
    const userId = await createSeller(AMOUNT);

    const result = await service.execute(withdrawalInput(userId));

    expect(result.status).toBe("PENDING");
    expect(gateway.calls).toHaveLength(0);

    // The balance still moves: the money is set aside while an admin looks at
    // it, otherwise the seller could queue the same funds several times over.
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(Number(wallet.balance)).toBe(0);

    const ledger = await prisma.ledgerEntry.findMany({ where: { walletId: wallet.id } });
    expect(ledger.map((e) => e.type)).toEqual(["WITHDRAW_HOLD"]);
  });

  it("pays out automatically once one of the seller's payouts has been reviewed", async () => {
    const userId = await createSeller(AMOUNT);
    await seedReviewedWithdrawal(userId);

    const result = await service.execute(withdrawalInput(userId));

    expect(result.status).toBe("APPROVED");
    expect(gateway.calls).toHaveLength(1);
  });

  it("does not count another seller's reviewed payout as trust", async () => {
    const stranger = await createSeller(AMOUNT);
    await seedReviewedWithdrawal(stranger);
    const userId = await createSeller(AMOUNT);

    const result = await service.execute(withdrawalInput(userId));

    expect(result.status).toBe("PENDING");
    expect(gateway.calls).toHaveLength(0);
  });

  it("keeps holding while the seller's only prior request was rejected", async () => {
    const userId = await createSeller(AMOUNT);
    await prisma.sellerWithdrawalRequest.create({
      data: {
        userId,
        amount: 1_000,
        status: "REJECTED",
        accountName: "Withdraw Subject",
        accountNumber: "1234567890",
        bankName: "BCA",
      },
    });

    const result = await service.execute(withdrawalInput(userId));

    expect(result.status).toBe("PENDING");
    expect(gateway.calls).toHaveLength(0);
  });
});
