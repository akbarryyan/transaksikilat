import { NextResponse } from "next/server";
import { prisma } from "@/src/infra/db/prisma";
import { requireAdminSession } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/tickets — list all tickets for admin
 */
export async function GET() {
  const auth = await requireAdminSession();
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const tickets = await prisma.ticket.findMany({
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { messages: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    success: true,
    data: tickets.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      user: t.user,
      lastMessage: t.messages[0]?.body ?? "",
      lastSender: t.messages[0]?.senderRole ?? "",
      messageCount: t._count.messages,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  });
}
