import { describe, expect, it } from "vitest";

import { BCRYPT_COST, MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/password-policy";

describe("password policy", () => {
  it("accepts an ordinary password", () => {
    expect(validateNewPassword("kopi-pagi-2026")).toBeNull();
  });

  it("refuses anything shorter than the minimum", () => {
    expect(validateNewPassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toContain(
      String(MIN_PASSWORD_LENGTH)
    );
    expect(validateNewPassword("x".repeat(MIN_PASSWORD_LENGTH))).not.toContain(
      String(MIN_PASSWORD_LENGTH)
    );
  });

  it("refuses a single character repeated, however long", () => {
    expect(validateNewPassword("aaaaaaaaaaaa")).not.toBeNull();
  });

  it("refuses the passwords everyone tries first, whatever the casing", () => {
    expect(validateNewPassword("password123")).not.toBeNull();
    expect(validateNewPassword("PassWord123")).not.toBeNull();
    expect(validateNewPassword("12345678")).not.toBeNull();
  });

  it("refuses a missing or non-string password", () => {
    expect(validateNewPassword(undefined)).not.toBeNull();
    expect(validateNewPassword("")).not.toBeNull();
    expect(validateNewPassword(12345678)).not.toBeNull();
  });

  it("hashes new passwords at a cost above bcrypt's dated default", () => {
    expect(BCRYPT_COST).toBeGreaterThanOrEqual(12);
  });
});
