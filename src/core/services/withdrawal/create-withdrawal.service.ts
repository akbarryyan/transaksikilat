import { SellerWithdrawalRepository } from "@/src/infra/db/repositories/seller-withdrawal.repository";
import { IPayoutGatewayPort } from "@/src/core/ports/payout-gateway.port";
import { InsufficientBalanceError, ValidationError } from "@/src/core/domain/errors/domain.errors";

export interface CreateWithdrawalInput {
  userId: string;
  amount: number;
  bankCode?: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  note?: string;
}

function resolvePayoutCallbackUrl(): string | null {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "";

  if (!baseUrl) return null;
  return `${baseUrl.replace(/\/+$/, "")}/api/webhook/poppay`;
}

/**
 * CreateWithdrawalService
 *
 * Holds the seller's balance first (atomic debit, rolled back entirely if
 * insufficient), then submits the payout. If the payout — bank code
 * resolution or the outgoing transfer itself — fails, the hold is reversed:
 * the money goes back and the request is rejected. The seller is never left
 * holding a PENDING request with no money and no payout in flight.
 *
 * A seller's first payout is the exception: it stops at the hold and waits for
 * an admin. Becoming a merchant takes one request and no approval, so without
 * this an account created minutes ago could send money to any bank account it
 * liked before anyone saw it. Once an admin has approved one payout the account
 * is known, and later requests go straight out as before.
 */
export class CreateWithdrawalService {
  constructor(
    private readonly repo: SellerWithdrawalRepository,
    private readonly payoutGateway: IPayoutGatewayPort
  ) {}

  async execute(input: CreateWithdrawalInput) {
    const held = await this.repo.createHold(input);
    if (!held) {
      throw new InsufficientBalanceError("Saldo seller tidak cukup untuk withdraw");
    }

    // The hold stays either way: the money is set aside while the request waits,
    // otherwise the same balance could be queued several times over.
    if (!(await this.repo.hasReviewedWithdrawal(input.userId))) {
      return held;
    }

    try {
      const bankCode = await this.payoutGateway.resolveBankCode(input.bankCode, input.bankName);

      const payout = await this.payoutGateway.createOutgoing({
        aggRefId: `withdraw-${held.id}`,
        amount: input.amount,
        bankCode,
        destinationAccountNumber: input.accountNumber,
        destinationAccountName: input.accountName,
        notes: input.note || `Withdraw merchant ${held.id}`,
        callbackUrl: resolvePayoutCallbackUrl(),
      });

      return await this.repo.markApproved(held.id, {
        gatewayName: this.payoutGateway.gatewayName,
        bankCode,
        refId: payout.refId,
        aggregatorRefId: payout.aggregatorRefId,
        raw: payout.raw,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gagal membuat request withdraw";
      await this.repo.releaseHold(held.id, message);
      throw new ValidationError(message);
    }
  }
}
