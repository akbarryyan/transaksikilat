import { afterEach, describe, expect, it, vi } from "vitest";

import { shouldUseSecureCookies } from "@/lib/session";

describe("shouldUseSecureCookies", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false outside production regardless of APP_URL", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", "https://transaksikilat.com");
    expect(shouldUseSecureCookies()).toBe(false);
  });

  it("is true in production even when APP_URL is missing", () => {
    // The exact failure mode this guards: APP_URL unset or misconfigured
    // while the app is still served over HTTPS (e.g. behind a proxy) must
    // not silently strip Secure from the session cookie.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    expect(shouldUseSecureCookies()).toBe(true);
  });

  it("is true in production when APP_URL doesn't start with https://", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "transaksikilat.com");
    expect(shouldUseSecureCookies()).toBe(true);
  });

  it("is true in production with a well-formed APP_URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://transaksikilat.com");
    expect(shouldUseSecureCookies()).toBe(true);
  });
});
