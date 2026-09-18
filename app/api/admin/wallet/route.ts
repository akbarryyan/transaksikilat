import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/infra/db/prisma";
import { Prisma } from "@prisma/client";
import { requireAdminSession } from "@/lib/admin";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/wallet
 * Daftar semua user beserta info wallet (balance, total ledger entries)
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminSession();
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";

  try {
    const users = await prisma.user.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        wallet: {
          select: {
            id: true,
            balance: true,
            updatedAt: true,
            _count: { select: { ledgerEntries: true } },
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt,
        wallet: u.wallet
          ? {
              id: u.wallet.id,
              balance: Number(u.wallet.balance),
              entryCount: u.wallet._count.ledgerEntries,
              updatedAt: u.wallet.updatedAt,
            }
          : null,
      })),
    });
  } catch (err) {
    console.error("[wallet GET]", err);
    return NextResponse.json(
      { success: false, error: "Gagal mengambil data wallet" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/wallet
 * Body: { action: "CREDIT"|"HOLD"|"DEBIT"|"RELEASE"|"REFUND", userId, amount, reference?, description? }
 *
 * CREDIT  → tambah saldo (top-up, refund manual, dll.)
 * HOLD    → tahan saldo (kurangi balance untuk transaksi pending)
 * RELEASE → kembalikan hold (batal transaksi)
 * DEBIT   → potong saldo langsung (tanpa hold step)
 * REFUND  → kembalikan saldo setelah debit
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminSession();
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  let body: {
    action: string;
    userId: string;
    amount: number;
    reference?: string;
    description?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload tidak valid" }, { status: 400 });
  }

  const { action, userId, amount, reference, description } = body;

  const VALID_ACTIONS = ["CREDIT", "HOLD", "DEBIT", "RELEASE", "REFUND"];
  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ success: false, error: `Action tidak valid. Gunakan: ${VALID_ACTIONS.join(", ")}` }, { status: 400 });
  }

  if (!userId) {
    return NextResponse.json({ success: false, error: "userId wajib diisi" }, { status: 400 });
  }

  const parsedAmount = Number(amount);
  if (!parsedAmount || parsedAmount <= 0) {
    return NextResponse.json({ success: false, error: "Amount harus lebih dari 0" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Ambil atau buat wallet user
      let wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        // Auto-create wallet jika belum ada
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error("User tidak ditemukan");
        wallet = await tx.wallet.create({
          data: { userId, balance: new Prisma.Decimal(0) },
        });
      }

      const isCredit =
        action === "CREDIT" || action === "RELEASE" || action === "REFUND";

      // Both branches move the balance in a single conditional UPDATE, so two
      // simultaneous operations cannot read the same starting balance and both
      // write their own total over it.
      let balanceAfter: number;
      if (isCredit) {
        const credited = await tx.wallet.update({
          where: { id: wallet!.id },
          data: { balance: { increment: parsedAmount } },
        });
        balanceAfter = Number(credited.balance);
      } else {
        const debited = await tx.wallet.updateMany({
          where: { id: wallet!.id, balance: { gte: parsedAmount } },
          data: { balance: { decrement: parsedAmount } },
        });
        if (debited.count === 0) {
          const current = await tx.wallet.findUniqueOrThrow({ where: { id: wallet!.id } });
          throw new Error(
            `Saldo tidak cukup. Saldo saat ini: Rp ${Number(current.balance).toLocaleString("id")}`
          );
        }
        balanceAfter = Number(
          (await tx.wallet.findUniqueOrThrow({ where: { id: wallet!.id } })).balance
        );
      }

      const balanceBefore = isCredit
        ? balanceAfter - parsedAmount
        : balanceAfter + parsedAmount;

      // Catat ledger
      const entry = await tx.ledgerEntry.create({
        data: {
          walletId: wallet!.id,
          type: action,
          amount: new Prisma.Decimal(parsedAmount),
          balanceBefore: new Prisma.Decimal(balanceBefore),
          balanceAfter: new Prisma.Decimal(balanceAfter),
          reference: reference ?? null,
          description: description ?? null,
        },
      });

      return { wallet: { id: wallet!.id, balanceBefore, balanceAfter }, entry };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (err: unknown) {
    console.error("[wallet POST]", err);
    return NextResponse.json(
      { success: false, error: errorMessage(err, "Gagal memproses operasi wallet") },
      { status: 400 }
    );
  }
}
