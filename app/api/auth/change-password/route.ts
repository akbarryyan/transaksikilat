import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSession, revokeUserSessions } from "@/lib/session";
import { BCRYPT_COST, validateNewPassword } from "@/lib/password-policy";
import { prisma } from "@/src/infra/db/prisma";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();

    if (!session.isLoggedIn || !session.userId) {
      return NextResponse.json(
        { success: false, message: "Silakan login terlebih dahulu." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { currentPassword, newPassword } = body;

    // Validasi
    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { success: false, message: "Semua field wajib diisi." },
        { status: 400 }
      );
    }

    const passwordProblem = validateNewPassword(newPassword);
    if (passwordProblem) {
      return NextResponse.json({ success: false, message: passwordProblem }, { status: 400 });
    }

    // Ambil user dengan passwordHash
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, passwordHash: true },
    });

    if (!user || !user.passwordHash) {
      return NextResponse.json(
        { success: false, message: "Akun tidak ditemukan." },
        { status: 404 }
      );
    }

    // Verifikasi password lama
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { success: false, message: "Password saat ini tidak sesuai." },
        { status: 401 }
      );
    }

    // Tidak boleh sama dengan password lama
    const isSame = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSame) {
      return NextResponse.json(
        { success: false, message: "Password baru tidak boleh sama dengan password lama." },
        { status: 400 }
      );
    }

    // Hash dan simpan password baru
    const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await prisma.user.update({
      where: { id: session.userId },
      data: { passwordHash: newHash },
    });

    // Changing a password is what someone does after their account is taken
    // over, so every cookie already out there has to stop working — otherwise
    // the intruder keeps their access for the rest of the week. The browser
    // doing the change carries the new version forward so it stays signed in.
    session.sessionVersion = await revokeUserSessions(session.userId);
    await session.save();

    return NextResponse.json({
      success: true,
      message: "Password berhasil diubah. Sesi lain di perangkat lain sudah dikeluarkan.",
    });
  } catch (error) {
    console.error("[CHANGE PASSWORD ERROR]", error);
    return NextResponse.json(
      { success: false, message: "Terjadi kesalahan server. Coba lagi." },
      { status: 500 }
    );
  }
}
