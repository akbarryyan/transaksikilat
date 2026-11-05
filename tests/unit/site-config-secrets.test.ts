import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  raw: {} as Record<string, string>,
  set: [] as Array<[string, string]>,
  deleted: [] as string[],
}));

vi.mock("@/lib/admin", () => ({
  requireAdminSession: async () => ({ session: {} }),
}));
vi.mock("@/lib/site-config", () => ({
  DEFAULT_HEADER_COLOR: "#000000",
  normalizeHexColor: (v: string | undefined, d: string) => v || d,
  getAllSiteConfig: async () => state.raw,
  getAllProviderModes: async () => ({}),
  setSiteConfig: async (k: string, v: string) => void state.set.push([k, v]),
  deleteSiteConfig: async (k: string) => void state.deleted.push(k),
  invalidateSiteConfigCache: () => {},
}));
vi.mock("@/src/infra/providers/provider.factory", () => ({
  initProviderModesFromDB: async () => {},
}));

import { GET, PATCH } from "@/app/api/admin/site-config/route";

const TOKEN = "tok-DB-1234567890";
const SECRET = "sec-DB-abcdefghij";
const PASSWORD = "pwd-DB-qwertyuiop";

beforeEach(() => {
  state.raw = {
    POPPAY_INTEGRATOR_TOKEN: TOKEN,
    POPPAY_SECRET_KEY: SECRET,
    POPPAY_PASSWORD: PASSWORD,
    POPPAY_EMAIL: "merchant@example.com",
  };
  state.set = [];
  state.deleted = [];
  process.env.POPPAY_INTEGRATOR_TOKEN = "tok-ENV-zzzzzzzz";
  process.env.POPPAY_SECRET_KEY = "sec-ENV-zzzzzzzz";
  process.env.POPPAY_PASSWORD = "pwd-ENV-zzzzzzzz";
});

describe("GET /api/admin/site-config — Poppay credentials", () => {
  it("never puts a credential value anywhere in the response body", async () => {
    const body = await (await GET()).text();

    for (const leaked of [
      TOKEN,
      SECRET,
      PASSWORD,
      "tok-ENV-zzzzzzzz",
      "sec-ENV-zzzzzzzz",
      "pwd-ENV-zzzzzzzz",
    ]) {
      expect(body).not.toContain(leaked);
    }
  });

  it("reports whether each credential is configured instead", async () => {
    const { data } = await (await GET()).json();

    expect(data.secretsConfigured).toEqual({
      POPPAY_INTEGRATOR_TOKEN: true,
      POPPAY_SECRET_KEY: true,
      POPPAY_PASSWORD: true,
    });
  });

  it("reports a credential as not configured when neither DB nor env has it", async () => {
    state.raw = {};
    delete process.env.POPPAY_INTEGRATOR_TOKEN;

    const { data } = await (await GET()).json();

    expect(data.secretsConfigured.POPPAY_INTEGRATOR_TOKEN).toBe(false);
  });

  it("still returns the non-secret Poppay settings", async () => {
    const { data } = await (await GET()).json();

    expect(data.raw.POPPAY_EMAIL).toBe("merchant@example.com");
  });
});

describe("PATCH /api/admin/site-config — Poppay credentials", () => {
  function patch(key: string, value: string) {
    return PATCH(
      new Request("http://x/api/admin/site-config", {
        method: "PATCH",
        body: JSON.stringify({ key, value }),
      })
    );
  }

  it("saves a new credential but does not echo it back", async () => {
    const res = await patch("POPPAY_SECRET_KEY", "brand-new-secret-value");
    const text = await res.text();

    expect(state.set).toContainEqual(["POPPAY_SECRET_KEY", "brand-new-secret-value"]);
    expect(text).not.toContain("brand-new-secret-value");
  });

  it("still echoes non-secret values", async () => {
    const res = await patch("POPPAY_EMAIL", "new@example.com");

    expect((await res.json()).data.value).toBe("new@example.com");
  });
});
