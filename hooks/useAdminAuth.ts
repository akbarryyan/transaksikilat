"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

/**
 * Hook to check admin authentication.
 * Redirects to /admin/login if not authenticated.
 * Returns { user, loading } — render nothing while loading is true.
 */
export function useAdminAuth() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [checked, setChecked] = useState(false);

  // The login page needs no check, so derive the flag instead of writing state
  // from the effect — a synchronous setState there costs an extra render pass.
  const isLoginPage = pathname === "/admin/login";
  const loading = !isLoginPage && !checked;

  useEffect(() => {
    if (isLoginPage) return;

    fetch("/api/admin/auth")
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) {
          setUser(data.user);
        } else {
          router.replace("/admin/login?reason=unauthorized");
        }
      })
      .catch(() => {
        router.replace("/admin/login?reason=unauthorized");
      })
      .finally(() => setChecked(true));
  }, [isLoginPage, router]);

  return { user, loading };
}
