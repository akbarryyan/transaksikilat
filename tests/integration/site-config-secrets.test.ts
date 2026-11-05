import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDatabase } from "../helpers/db";

const sessionState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock("@/lib/session", () => ({ getSession: async () => sessionState.current }));

import { DELETE, GET, PATCH } from "@/app/api/admin/site-config/route";
import { GET as footerGET } from "@/app/api/footer-config/route";
import { GET as pageContentGET } from "@/app/api/page-content/[slug]/route";
import { invalidateSiteConfigCache } from "@/lib/site-config";

const SECRETS = {
  POPPAY_INTEGRATOR_TOKEN: "SENTINEL-TOKEN-7f3a91c2d4",
  POPPAY_SECRET_KEY: "SENTINEL-SECRET-b81e55a0c9",
  POPPAY_PASSWORD: "SENTINEL-PASSWORD-02d6f4e8aa",
};
const ENV_SECRETS = {
  POPPAY_INTEGRATOR_TOKEN: "SENTINEL-ENV-TOKEN-1111",
  POPPAY_SECRET_KEY: "SENTINEL-ENV-SECRET-2222",
  POPPAY_PASSWORD: "SENTINEL-ENV-PASSWORD-3333",
};
const ALL_SENTINELS = [...Object.values(SECRETS), ...Object.values(ENV_SECRETS)];

function patch(key: string, value: string) {
  return PATCH(
    new Request("http://x/api/admin/site-config", {
      method: "PATCH",
      body: JSON.stringify({ key, value }),
    })
  );
}

function expectNoLeak(text: string) {
  for (const s of ALL_SENTINELS) expect(text).not.toContain(s);
}

beforeEach(async () => {
  await resetDatabase();
  invalidateSiteConfigCache();
  sessionState.current = { isLoggedIn: true, userId: "admin-1", role: "ADMIN" };
  for (const [k, v] of Object.entries(ENV_SECRETS)) process.env[k] = v;
  for (const [k, v] of Object.entries(SECRETS)) {
    await prisma.siteConfig.create({ data: { key: k, value: v } });
  }
  await prisma.siteConfig.create({
    data: { key: "POPPAY_EMAIL", value: "merchant@example.com" },
  });
});

describe("site-config credentials — smoke (real DB)", () => {
  it("admin GET leaks neither DB-stored nor env credentials", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expectNoLeak(await res.text());
  });

  it("anonymous and non-admin callers get 401/403 and no data", async () => {
    sessionState.current = {};
    let res = await GET();
    expect(res.status).toBe(401);
    expectNoLeak(await res.text());

    sessionState.current = { isLoggedIn: true, userId: "u1", role: "USER" };
    res = await GET();
    expect(res.status).toBe(403);
    expectNoLeak(await res.text());
  });

  it("saved credential reaches the DB intact even though it is never echoed", async () => {
    const res = await patch("POPPAY_SECRET_KEY", "rotated-secret-value-123");
    expect(await res.text()).not.toContain("rotated-secret-value-123");

    const row = await prisma.siteConfig.findUnique({ where: { key: "POPPAY_SECRET_KEY" } });
    expect(row?.value).toBe("rotated-secret-value-123");
  });

  it("DELETE does not echo credentials and falls back to configured=env", async () => {
    const res = await DELETE(
      new Request("http://x/api/admin/site-config?key=POPPAY_PASSWORD", { method: "DELETE" })
    );
    expectNoLeak(await res.text());

    invalidateSiteConfigCache();
    const { data } = await (await GET()).json();
    // DB row gone, env value still present -> still configured.
    expect(data.secretsConfigured.POPPAY_PASSWORD).toBe(true);
  });

  it("public endpoints never carry credentials", async () => {
    expectNoLeak(await (await footerGET()).text());
    const res = await pageContentGET(new Request("http://x"), {
      params: Promise.resolve({ slug: "tentang-kami" }),
    });
    expectNoLeak(await res.text());
  });

  it("secret-looking values placed in a non-secret key are not hidden (control)", async () => {
    // Guards against the redaction being a blanket string filter that would
    // also mask unrelated config: only the three named keys are write-only.
    await patch("POPPAY_EMAIL", "visible@example.com");
    const { data } = await (await GET()).json();
    expect(data.raw.POPPAY_EMAIL).toBe("visible@example.com");
  });
});

describe("site-config credentials — stress (real DB)", () => {
  it("300 concurrent admin GETs never leak and never fail", async () => {
    const responses = await Promise.all(Array.from({ length: 300 }, () => GET()));
    const texts = await Promise.all(responses.map((r) => r.text()));

    expect(responses.every((r) => r.status === 200)).toBe(true);
    for (const t of texts) expectNoLeak(t);
  });

  it("concurrent GETs interleaved with credential writes never leak, and the DB ends on a written value", async () => {
    const writes = Array.from({ length: 40 }, (_, i) =>
      patch("POPPAY_INTEGRATOR_TOKEN", `SENTINEL-WRITE-${i}`)
    );
    const reads = Array.from({ length: 200 }, () => GET());

    const results = await Promise.all([...writes, ...reads]);
    const texts = await Promise.all(results.map((r) => r.text()));

    expect(results.every((r) => r.status === 200)).toBe(true);
    for (const t of texts) {
      expectNoLeak(t);
      expect(t).not.toMatch(/SENTINEL-WRITE-\d+/);
    }

    const row = await prisma.siteConfig.findUnique({ where: { key: "POPPAY_INTEGRATOR_TOKEN" } });
    expect(row?.value).toMatch(/^SENTINEL-WRITE-\d+$/);
  });

  it("hostile PATCH inputs are rejected or stored verbatim, never reflected", async () => {
    const hostile = [
      "<script>alert(1)</script>",
      "x".repeat(100_000),
      "'; DROP TABLE site_configs; --",
      "\u0000‮",
    ];
    for (const value of hostile) {
      const res = await patch("POPPAY_SECRET_KEY", value);
      const text = await res.text();
      expect(res.status).toBeLessThan(500);
      expect(text).not.toContain("<script>");
      expect(text.length).toBeLessThan(2000);
    }
    // Table still exists and still answers.
    expect((await GET()).status).toBe(200);
  });

  it("malformed bodies return 4xx, not 500, and leak nothing", async () => {
    for (const body of ["", "not json", "null", "[]", '{"key":1}', '{"value":"x"}']) {
      const res = await PATCH(
        new Request("http://x/api/admin/site-config", { method: "PATCH", body })
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expectNoLeak(await res.text());
    }
  });
});
