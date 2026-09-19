export interface PayoutInput {
  aggRefId: string;
  amount: number;
  bankCode: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
  notes: string;
  callbackUrl: string | null;
}

export interface PayoutResult {
  refId: string;
  aggregatorRefId: string;
  raw: Record<string, unknown> | null;
}

/** A gateway capable of sending money out to a bank account. */
export interface IPayoutGatewayPort {
  readonly gatewayName: string;

  /**
   * Resolves a bank name (as typed by the seller) to the gateway's bank code.
   * `explicitBankCode`, when present, is trusted as-is.
   */
  resolveBankCode(
    explicitBankCode: string | null | undefined,
    bankName: string
  ): Promise<string>;

  createOutgoing(input: PayoutInput): Promise<PayoutResult>;
}
