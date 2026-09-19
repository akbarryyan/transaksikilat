import { describe, expect, it, vi } from "vitest";

import { generateOTP } from "@/lib/fonnte";

describe("generateOTP", () => {
  it("returns a 6-digit numeric string", () => {
    for (let i = 0; i < 50; i += 1) {
      const otp = generateOTP();
      expect(otp).toMatch(/^\d{6}$/);
      const value = Number(otp);
      expect(value).toBeGreaterThanOrEqual(100000);
      expect(value).toBeLessThanOrEqual(999999);
    }
  });

  it("does not derive the code from Math.random", () => {
    // Math.random() is not a CSPRNG — an attacker who can predict or observe
    // its internal state could predict OTPs. Assert the code path never
    // touches it, rather than trying to prove non-predictability statistically.
    const spy = vi.spyOn(Math, "random");

    for (let i = 0; i < 20; i += 1) generateOTP();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
