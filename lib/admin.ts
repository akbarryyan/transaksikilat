import { getSession } from "@/lib/session";

export async function requireAdminSession() {
  const session = await getSession();

  if (!session.isLoggedIn || !session.userId) {
    return { error: "Unauthorized", status: 401 as const };
  }

  if (session.role !== "ADMIN") {
    return { error: "Forbidden", status: 403 as const };
  }

  return { session };
}
