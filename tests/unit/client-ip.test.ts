import { describe, expect, it } from "vitest";

import { clientIpFromHeaders } from "@/lib/login-rate-limit";

function headers(value?: string): Headers {
  const h = new Headers();
  if (value !== undefined) h.set("x-forwarded-for", value);
  return h;
}

describe("client IP for throttling", () => {
  it("takes the first hop of the forwarding chain", () => {
    expect(clientIpFromHeaders(headers("203.0.113.7, 10.0.0.1, 10.0.0.2"))).toBe("203.0.113.7");
  });

  it("trims the padding proxies leave behind", () => {
    expect(clientIpFromHeaders(headers("  203.0.113.7 , 10.0.0.1"))).toBe("203.0.113.7");
  });

  it("returns null when the header is absent or empty", () => {
    // Throttling then falls back to the identifier alone rather than grouping
    // every anonymous caller under one empty-string bucket.
    expect(clientIpFromHeaders(headers())).toBeNull();
    expect(clientIpFromHeaders(headers(""))).toBeNull();
    expect(clientIpFromHeaders(headers("   "))).toBeNull();
  });

  it("takes the header at face value", () => {
    // Worth stating plainly: this value is whatever the caller sent unless the
    // reverse proxy overwrites it. The proxy has to set X-Forwarded-For rather
    // than append to it, or per-IP throttling can be sidestepped by sending a
    // different value each attempt.
    expect(clientIpFromHeaders(headers("bukan-ip-sama-sekali"))).toBe("bukan-ip-sama-sekali");
  });
});
