import { prisma } from "@/src/infra/db/prisma";
import { Prisma } from "@prisma/client";

export interface CreateHoldInput {
  userId: string;
  amount: number;
  bankCode?: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  note?: string;
}

export interface ApproveInput {
  gatewayName: string;
  bankCode: string;
  refId: string;
  aggregatorRefId: string;
  raw: Record<string, unknown> | null;
}

function toJsonInput(
  value: Record<string, unknown> | null | undefined
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value ? (value as Prisma.InputJsonValue) : Prisma.JsonNull;
}

export class SellerWithdrawalRepository {
  async getWalletAndHistory(userId: string) {
    const [wallet, withdrawals] = await Promise.all([
      prisma.wallet.findUnique({
        where: { userId },
        select: { balance: true, updatedAt: true },
      }),
      prisma.sellerWithdrawalRequest.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return { wallet, withdrawals };
  }

  /**
   * True once one of this seller's payouts has been submitted to the gateway,
   * which only happens after an admin has approved one. Used to decide whether
   * a new request can go straight out or has to wait for review.
   */
  async hasReviewedWithdrawal(userId: string): Promise<boolean> {
    const count = await prisma.sellerWithdrawalRequest.count({
      where: { userId, status: { in: ["APPROVED", "PAID"] } },
    });
    return count > 0;
  }

  /**
   * Debits the wallet and creates the withdrawal request + HOLD ledger entry in
   * one transaction. The debit is a conditional UPDATE guarded on the balance
   * still covering the amount, so simultaneous withdrawals cannot each read the
   * same balance and all pass — money that then leaves to a real bank account.
   * Returns null (rolling back everything, including an auto-created wallet)
   * when the balance does not cover the amount.
   */
  async createHold(input: CreateHoldInput) {
    return prisma.$transaction(async (tx) => {
      let wallet = await tx.wallet.findUnique({ where: { userId: input.userId } });
      if (!wallet) {
        wallet = await tx.wallet.create({ data: { userId: input.userId, balance: 0 } });
      }

      const debited = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: { gte: input.amount } },
        data: { balance: { decrement: input.amount } },
      });
      if (debited.count === 0) return null;

      const balanceAfter = Number(
        (await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).balance
      );
      const balanceBefore = balanceAfter + input.amount;

      const request = await tx.sellerWithdrawalRequest.create({
        data: {
          userId: input.userId,
          amount: new Prisma.Decimal(input.amount),
          status: "PENDING",
          bankCode: input.bankCode?.trim() || null,
          accountName: input.accountName.trim(),
          accountNumber: input.accountNumber.trim(),
          bankName: input.bankName.trim(),
          note: input.note?.trim() || null,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          type: "WITHDRAW_HOLD",
          amount: new Prisma.Decimal(input.amount),
          balanceBefore: new Prisma.Decimal(balanceBefore),
          balanceAfter: new Prisma.Decimal(balanceAfter),
          reference: request.id,
          description: `Hold withdraw seller ${request.id}`,
        },
      });

      return request;
    });
  }

  async markApproved(requestId: string, input: ApproveInput) {
    return prisma.sellerWithdrawalRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        bankCode: input.bankCode,
        payoutGateway: input.gatewayName,
        payoutRefId: input.refId,
        payoutAggRefId: input.aggregatorRefId,
        payoutRawPayload: toJsonInput(input.raw),
        processedNote: "Payout otomatis dikirim ke gateway.",
        processedAt: new Date(),
      },
    });
  }

  /**
   * Reverses a hold that never got approved: credits the wallet back, records
   * a RELEASE ledger entry, and rejects the request. No-op if the request has
   * already moved past PENDING (e.g. released twice by a retried caller).
   */
  async releaseHold(requestId: string, reason: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const request = await tx.sellerWithdrawalRequest.findUnique({ where: { id: requestId } });
      if (!request || request.status !== "PENDING") return;

      const wallet = await tx.wallet.findUnique({ where: { userId: request.userId } });
      if (!wallet) return;

      const balanceAfter = Number(
        (
          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: request.amount } },
          })
        ).balance
      );
      const balanceBefore = balanceAfter - Number(request.amount);

      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          type: "WITHDRAW_RELEASE",
          amount: request.amount,
          balanceBefore: new Prisma.Decimal(balanceBefore),
          balanceAfter: new Prisma.Decimal(balanceAfter),
          reference: request.id,
          description: `Release withdraw seller ${request.id} karena create outgoing gagal`,
        },
      });

      await tx.sellerWithdrawalRequest.update({
        where: { id: request.id },
        data: {
          status: "REJECTED",
          processedNote: reason,
          processedAt: new Date(),
        },
      });
    });
  }
}
