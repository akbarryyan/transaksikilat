import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/lib/session", () => ({
  getRawSession: async () => sessionState.current,
  getSession: async () => sessionState.current,
}));

import { prisma, resetDatabase } from "@/tests/helpers/db";
import { invalidateSiteConfigCache } from "@/lib/site-config";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as verifyOtp } from "@/app/api/auth/otp/verify/route";

const PASSWORD = "kata-sandi-panjang-9";
const VERIFIED_EMAIL = "pendaftar@example.test";
const SOMEONE_ELSE = "korban@example.test";
const PHONE = "081234567890";

function jsonRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/auth/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function setOtpRequired(required: boolean) {
  await prisma.siteConfig.upsert({
    where: { key: "REGISTER_OTP_REQUIRED" },
    create: { key: "REGISTER_OTP_REQUIRED", value: required ? "true" : "false" },
    update: { value: required ? "true" : "false" },
  });
  invalidateSiteConfigCache();
}

async function seedVerifiedOtp(email: string) {
  await prisma.otpCode.create({
    data: {
      email,
      target: "email",
      code: "123456",
      purpose: "REGISTER",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  });
}

describe("registration cannot skip the email check", () => {
  beforeEach(async () => {
    await resetDatabase();
    invalidateSiteConfigCache();
    sessionState.current = { save: async () => {} };
  });

  it("refuses the direct sign-up route while OTP is required", async () => {
    // The form only calls this route when OTP is switched off, so anything
    // reaching it while OTP is on came from outside the app.
    await setOtpRequired(true);

    const res = await register(
      jsonRequest({
        name: "Pendaftar",
        email: VERIFIED_EMAIL,
        phone: PHONE,
        password: PASSWORD,
        confirmPassword: PASSWORD,
      })
    );

    expect(res.status).toBe(403);
    expect(await prisma.user.count()).toBe(0);
  });

  it("still allows direct sign-up when OTP is switched off", async () => {
    await setOtpRequired(false);

    const res = await register(
      jsonRequest({
        name: "Pendaftar",
        email: VERIFIED_EMAIL,
        phone: PHONE,
        password: PASSWORD,
        confirmPassword: PASSWORD,
      })
    );

    expect(res.status).toBe(200);
    expect(await prisma.user.count()).toBe(1);
  });

  it("refuses to register an address other than the one that was verified", async () => {
    // Verifying your own inbox and then handing over somebody else's address
    // would make the OTP prove nothing at all.
    await setOtpRequired(true);
    await seedVerifiedOtp(VERIFIED_EMAIL);

    const res = await verifyOtp(
      jsonRequest({
        code: "123456",
        purpose: "REGISTER",
        target: "email",
        email: VERIFIED_EMAIL,
        name: "Penyerang",
        password: PASSWORD,
        regEmail: SOMEONE_ELSE,
        regPhone: PHONE,
      })
    );

    expect(res.status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it("registers the verified address when they match", async () => {
    await setOtpRequired(true);
    await seedVerifiedOtp(VERIFIED_EMAIL);

    const res = await verifyOtp(
      jsonRequest({
        code: "123456",
        purpose: "REGISTER",
        target: "email",
        email: VERIFIED_EMAIL,
        name: "Pendaftar",
        password: PASSWORD,
        regEmail: VERIFIED_EMAIL,
        regPhone: PHONE,
      })
    );

    expect(res.status).toBe(200);
    const user = await prisma.user.findFirstOrThrow();
    expect(user.email).toBe(VERIFIED_EMAIL);
    expect(user.phone).toBe(PHONE);
  });

  it("registers the verified address when regEmail is left out entirely", async () => {
    await setOtpRequired(true);
    await seedVerifiedOtp(VERIFIED_EMAIL);

    const res = await verifyOtp(
      jsonRequest({
        code: "123456",
        purpose: "REGISTER",
        target: "email",
        email: VERIFIED_EMAIL,
        name: "Pendaftar",
        password: PASSWORD,
      })
    );

    expect(res.status).toBe(200);
    const user = await prisma.user.findFirstOrThrow();
    expect(user.email).toBe(VERIFIED_EMAIL);
  });
});
