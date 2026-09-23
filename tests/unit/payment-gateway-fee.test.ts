import { describe, expect, it } from "vitest";

import {
  calculatePaymentGatewayFee,
  normalizePaymentGatewayFeeConfig,
  normalizePaymentGatewayFeeType,
} from "@/lib/payment-gateway-fee";

const PERCENT = { type: "PERCENT" as const, value: 0.7 };
const FIXED = { type: "FIXED" as const, value: 1_500 };

describe("payment gateway fee", () => {
  it("adds a fixed fee whatever the amount", () => {
    expect(calculatePaymentGatewayFee("qris", 10_000, FIXED)).toBe(1_500);
    expect(calculatePaymentGatewayFee("qris", 500_000, FIXED)).toBe(1_500);
  });

  it("rounds a percentage fee up, never leaving the platform short", () => {
    // 0.7% of 10_000 is 70 exactly.
    expect(calculatePaymentGatewayFee("qris", 10_000, PERCENT)).toBe(70);
    // 0.7% of 10_001 is 70.007 — the remainder is still ours to pay.
    expect(calculatePaymentGatewayFee("qris", 10_001, PERCENT)).toBe(71);
  });

  it("charges nothing for a method the gateway does not bill for", () => {
    expect(calculatePaymentGatewayFee("bca_va", 100_000, FIXED)).toBe(0);
  });

  it("treats an unspecified method as QRIS", () => {
    // Checkout passes the method through as optional, so a missing one has to
    // land on the method that is actually configured rather than silently free.
    expect(calculatePaymentGatewayFee(null, 10_000, FIXED)).toBe(1_500);
    expect(calculatePaymentGatewayFee("", 10_000, FIXED)).toBe(1_500);
  });

  it("ignores case and padding around the method name", () => {
    expect(calculatePaymentGatewayFee("  QRIS ", 10_000, FIXED)).toBe(1_500);
  });

  it("charges nothing on an amount that is not a positive number", () => {
    expect(calculatePaymentGatewayFee("qris", 0, FIXED)).toBe(0);
    expect(calculatePaymentGatewayFee("qris", -10_000, FIXED)).toBe(0);
    expect(calculatePaymentGatewayFee("qris", Number.NaN, FIXED)).toBe(0);
  });

  it("never returns a negative fee, however the config is misconfigured", () => {
    expect(calculatePaymentGatewayFee("qris", 10_000, { type: "FIXED", value: -5_000 })).toBe(0);
    expect(calculatePaymentGatewayFee("qris", 10_000, { type: "PERCENT", value: -10 })).toBe(0);
    expect(calculatePaymentGatewayFee("qris", 10_000, null)).toBe(0);
  });

  it("falls back to no fee rather than guessing when the config is unusable", () => {
    expect(normalizePaymentGatewayFeeConfig(null)).toEqual({ type: "FIXED", value: 0 });
    expect(normalizePaymentGatewayFeeConfig({ type: "PERCENT", value: Number.NaN })).toEqual({
      type: "PERCENT",
      value: 0,
    });
  });

  it("reads anything that is not PERCENT as a fixed fee", () => {
    expect(normalizePaymentGatewayFeeType("PERCENT")).toBe("PERCENT");
    expect(normalizePaymentGatewayFeeType("percent")).toBe("FIXED");
    expect(normalizePaymentGatewayFeeType(null)).toBe("FIXED");
    expect(normalizePaymentGatewayFeeType("nonsense")).toBe("FIXED");
  });
});
