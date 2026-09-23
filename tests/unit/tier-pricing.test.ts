import { describe, expect, it } from "vitest";

import { calcTierPrice } from "@/lib/pricing";

const PROVIDER_PRICE = 14_000;
const MARGIN = 2_000;

describe("tier pricing", () => {
  it("charges the full margin at the default multiplier", () => {
    expect(calcTierPrice(PROVIDER_PRICE, MARGIN, 1)).toEqual({
      markup: 2_000,
      sellingPrice: 16_000,
    });
  });

  it("discounts the margin, not the cost", () => {
    // A reseller at 0.8 pays 20% less margin — 1_600, not 20% off 16_000.
    expect(calcTierPrice(PROVIDER_PRICE, MARGIN, 0.8)).toEqual({
      markup: 1_600,
      sellingPrice: 15_600,
    });
  });

  it("never sells below what the provider costs us", () => {
    // Even at a zero multiplier the floor is the provider price.
    expect(calcTierPrice(PROVIDER_PRICE, MARGIN, 0)).toEqual({
      markup: 0,
      sellingPrice: PROVIDER_PRICE,
    });
  });

  it("rounds the markup to whole rupiah", () => {
    // 2_000 * 0.855 = 1_710 exactly; 1_999 * 0.855 = 1_709.145 rounds down.
    expect(calcTierPrice(PROVIDER_PRICE, 2_000, 0.855).markup).toBe(1_710);
    expect(calcTierPrice(PROVIDER_PRICE, 1_999, 0.855).markup).toBe(1_709);
  });

  it("keeps the selling price equal to cost plus markup", () => {
    for (const multiplier of [1, 0.9, 0.75, 0.6, 0.5]) {
      const { markup, sellingPrice } = calcTierPrice(PROVIDER_PRICE, MARGIN, multiplier);
      expect(sellingPrice).toBe(PROVIDER_PRICE + markup);
    }
  });
});
