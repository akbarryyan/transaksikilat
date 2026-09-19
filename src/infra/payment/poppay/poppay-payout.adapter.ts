import { PoppayClient } from "@/src/infra/payment/poppay/poppay.client";
import type {
  IPayoutGatewayPort,
  PayoutInput,
  PayoutResult,
} from "@/src/core/ports/payout-gateway.port";

function normalizeBankLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(pt|tbk|persero)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export class PoppayPayoutAdapter implements IPayoutGatewayPort {
  readonly gatewayName = "POPPAY";
  private readonly client = new PoppayClient();

  async resolveBankCode(
    explicitBankCode: string | null | undefined,
    bankName: string
  ): Promise<string> {
    if (explicitBankCode?.trim()) return explicitBankCode.trim();

    const banks = await this.client.listBanks({
      start: 0,
      length: 500,
      filters: [{ key: "c", value: "IDR" }],
    });
    const normalizedTarget = normalizeBankLabel(bankName);

    const exact = banks.data.find((item) => normalizeBankLabel(item.name) === normalizedTarget);
    if (exact) return exact.code;

    const contains = banks.data.filter((item) =>
      normalizeBankLabel(item.name).includes(normalizedTarget)
    );
    if (contains.length === 1) return contains[0].code;

    throw new Error(
      `Kode bank Poppay untuk "${bankName}" belum ditemukan. Mohon pilih nama bank yang lebih spesifik atau simpan bankCode.`
    );
  }

  async createOutgoing(input: PayoutInput): Promise<PayoutResult> {
    const payout = await this.client.createOutgoing({
      aggRefId: input.aggRefId,
      amount: input.amount,
      bankCode: input.bankCode,
      destinationAccountNumber: input.destinationAccountNumber,
      destinationAccountName: input.destinationAccountName,
      notes: input.notes,
      callbackUrl: input.callbackUrl,
    });

    return {
      refId: payout.refId,
      aggregatorRefId: payout.aggregatorRefId,
      raw: payout.raw,
    };
  }
}
