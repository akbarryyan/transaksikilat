import { describe, expect, it } from "vitest";

import { assertEnv, validateEnv } from "@/lib/env";

const VALID = {
  DATABASE_URL: "mysql://user:pass@localhost:3306/db",
  SESSION_SECRET: "a".repeat(32),
};

describe("validateEnv", () => {
  it("accepts a fully configured environment", () => {
    expect(validateEnv(VALID)).toEqual([]);
  });

  it("reports a missing database url", () => {
    const problems = validateEnv({ ...VALID, DATABASE_URL: undefined });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("DATABASE_URL");
  });

  it("treats a blank value as missing", () => {
    const problems = validateEnv({ ...VALID, SESSION_SECRET: "   " });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("SESSION_SECRET");
  });

  it("rejects a session secret shorter than iron-session allows", () => {
    const problems = validateEnv({ ...VALID, SESSION_SECRET: "too-short" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("32");
  });

  it("reports every problem at once rather than the first", () => {
    expect(validateEnv({})).toHaveLength(2);
  });
});

describe("assertEnv", () => {
  it("stays quiet when the environment is valid", () => {
    expect(() => assertEnv(VALID)).not.toThrow();
  });

  it("throws naming the offending variable", () => {
    expect(() => assertEnv({ ...VALID, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });
});
