import { describe, expect, it } from "vitest";

import { slugifySellerName } from "@/lib/seller";

describe("seller slug", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugifySellerName("Toko Mas Budi")).toBe("toko-mas-budi");
  });

  it("drops characters that have no business in a URL", () => {
    // The slug becomes a public path at /seller/<slug>.
    expect(slugifySellerName("Toko <script>alert(1)</script>")).toBe("toko-scriptalert1script");
    expect(slugifySellerName("toko/../admin")).toBe("tokoadmin");
    expect(slugifySellerName("toko?a=1&b=2")).toBe("tokoa1b2");
  });

  it("collapses runs of spaces and dashes into one", () => {
    expect(slugifySellerName("Toko    Mas   Budi")).toBe("toko-mas-budi");
    expect(slugifySellerName("toko---mas")).toBe("toko-mas");
  });

  it("never starts or ends with a dash", () => {
    expect(slugifySellerName("  -- Toko Mas --  ")).toBe("toko-mas");
  });

  it("caps the length so it always fits the column", () => {
    expect(slugifySellerName("a".repeat(200))).toHaveLength(80);
  });

  it("returns an empty string when nothing usable is left", () => {
    // The route checks for this and refuses rather than storing a blank slug.
    expect(slugifySellerName("!!!")).toBe("");
    expect(slugifySellerName("   ")).toBe("");
  });
});
