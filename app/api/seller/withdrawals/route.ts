import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSellerSession } from "@/lib/seller";
import { CreateWithdrawalService } from "@/src/core/services/withdrawal/create-withdrawal.service";
import { SellerWithdrawalRepository } from "@/src/infra/db/repositories/seller-withdrawal.repository";
import { PoppayPayoutAdapter } from "@/src/infra/payment/poppay/poppay-payout.adapter";
import { InsufficientBalanceError, DomainError } from "@/src/core/domain/errors/domain.errors";

export const dynamic = "force-dynamic";

const WithdrawalSchema = z.object({
  amount: z.number().positive(),
  bankCode: z.string().trim().max(40).optional(),
  accountName: z.string().min(2).max(120),
  accountNumber: z.string().min(3).max(80),
  bankName: z.string().min(2).max(120),
  note: z.string().max(1000).optional(),
});

export async function GET() {
  const seller = await requireSellerSession();
  if ("error" in seller) {
    return NextResponse.json({ success: false, error: seller.error }, { status: seller.status });
  }

  const repo = new SellerWithdrawalRepository();
  const { wallet, withdrawals } = await repo.getWalletAndHistory(seller.session.userId!);

  return NextResponse.json({
    success: true,
    wallet: wallet
      ? {
          balance: Number(wallet.balance),
          updatedAt: wallet.updatedAt,
        }
      : { balance: 0, updatedAt: null },
    data: withdrawals.map((item) => ({
      ...item,
      amount: Number(item.amount),
    })),
  });
}

export async function POST(req: NextRequest) {
  const seller = await requireSellerSession();
  if ("error" in seller) {
    return NextResponse.json({ success: false, error: seller.error }, { status: seller.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload tidak valid" }, { status: 400 });
  }

  const parsed = WithdrawalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation error", details: parsed.error.flatten() }, { status: 422 });
  }

  const service = new CreateWithdrawalService(
    new SellerWithdrawalRepository(),
    new PoppayPayoutAdapter()
  );

  try {
    const result = await service.execute({
      userId: seller.session.userId!,
      amount: parsed.data.amount,
      bankCode: parsed.data.bankCode,
      accountName: parsed.data.accountName,
      accountNumber: parsed.data.accountNumber,
      bankName: parsed.data.bankName,
      note: parsed.data.note,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        amount: Number(result.amount),
      },
    });
  } catch (error) {
    if (error instanceof InsufficientBalanceError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    if (error instanceof DomainError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Gagal membuat request withdraw";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
