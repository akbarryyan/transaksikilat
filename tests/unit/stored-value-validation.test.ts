import { describe, expect, it } from "vitest";

import { imageRefSchema } from "@/lib/upload";
import { normalizeHexColor, DEFAULT_HEADER_COLOR } from "@/lib/site-config";

function accepts(value: string): boolean {
  return imageRefSchema.safeParse(value).success;
}

describe("image references stored from a form", () => {
  it("accepts a local upload path and an absolute http(s) URL", () => {
    expect(accepts("/uploads/promos/abc.png")).toBe(true);
    expect(accepts("https://i.ibb.co.com/abc/x.png")).toBe(true);
    expect(accepts("http://example.test/x.png")).toBe(true);
  });

  it("refuses schemes that execute rather than load", () => {
    // These land in an img src, so a javascript: or data: value is the whole
    // game.
    expect(accepts("javascript:alert(1)")).toBe(false);
    expect(accepts("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(accepts("vbscript:msgbox(1)")).toBe(false);
  });

  it("refuses paths that are neither an upload nor a URL", () => {
    expect(accepts("//evil.test/x.png")).toBe(false);
    expect(accepts("../../etc/passwd")).toBe(false);
    expect(accepts("/etc/passwd")).toBe(false);
    expect(accepts("")).toBe(false);
  });
});

describe("header colour", () => {
  it("accepts a six-digit hex colour and normalises its case", () => {
    expect(normalizeHexColor("#00ff99")).toBe("#00FF99");
    expect(normalizeHexColor("  #003D99  ")).toBe("#003D99");
  });

  it("falls back rather than storing anything else", () => {
    // The value is interpolated into inline styles, so a loose one would let a
    // colour field carry CSS.
    expect(normalizeHexColor("red")).toBe(DEFAULT_HEADER_COLOR);
    expect(normalizeHexColor("#fff")).toBe(DEFAULT_HEADER_COLOR);
    expect(normalizeHexColor("#003D99; background:url(x)")).toBe(DEFAULT_HEADER_COLOR);
    expect(normalizeHexColor(null)).toBe(DEFAULT_HEADER_COLOR);
    expect(normalizeHexColor(undefined)).toBe(DEFAULT_HEADER_COLOR);
  });

  it("uses the caller's fallback when one is given", () => {
    expect(normalizeHexColor("bukan-warna", "#123456")).toBe("#123456");
  });
});
