import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

async function headerMap(): Promise<Record<string, string>> {
  const entries = await nextConfig.headers!();
  const global = entries.find((entry) => entry.source === "/:path*");
  if (!global) throw new Error("no catch-all header rule configured");

  return Object.fromEntries(global.headers.map((h) => [h.key, h.value]));
}

describe("security headers", () => {
  it("withholds the referrer", async () => {
    // Order codes and guest view tokens both travel in URLs, so a referrer
    // hands them to every third party a page happens to touch.
    expect((await headerMap())["Referrer-Policy"]).toBe("no-referrer");
  });

  it("refuses to be framed", async () => {
    // Checkout, top-up and withdraw are all one click on an authenticated page.
    expect((await headerMap())["X-Frame-Options"]).toBe("DENY");
  });

  it("stops content-type sniffing", async () => {
    // /uploads/* is served straight off disk.
    expect((await headerMap())["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("asks browsers to stay on HTTPS", async () => {
    const value = (await headerMap())["Strict-Transport-Security"];
    expect(value).toContain("max-age=");
    // Deliberately not preloaded, and not extended to subdomains that may not
    // all be on HTTPS yet.
    expect(value).not.toContain("preload");
  });

  it("turns off device APIs the app never asks for", async () => {
    expect((await headerMap())["Permissions-Policy"]).toContain("camera=()");
  });
});
