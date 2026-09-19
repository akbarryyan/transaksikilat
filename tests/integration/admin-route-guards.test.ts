import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/lib/session", () => ({
  getSession: async () => sessionState.current,
}));

/**
 * Handlers under /api/admin that are reachable without an admin session on
 * purpose. Anything not listed here must reject both anonymous and non-admin
 * callers. Add an entry only with a reason.
 */
const PUBLIC_BY_DESIGN: Record<string, readonly string[]> = {
  // The admin login endpoint itself, plus its session-probe GET.
  "/app/api/admin/auth/route.ts": ["GET", "POST"],
  // GET returns only the maintenance-mode boolean, which the public site needs
  // to render its maintenance state. The mutating PATCH stays admin-only.
  "/app/api/admin/maintenance/route.ts": ["GET"],
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const globImport = (
  import.meta as unknown as {
    glob: (
      pattern: string
    ) => Record<string, () => Promise<Record<string, unknown>>>;
  }
).glob("../../app/api/admin/**/route.ts");

const routeModules = Object.entries(globImport)
  .map(([path, load]) => ({ path: path.replace(/^\.\.\/\.\./, ""), load }))
  .sort((a, b) => a.path.localeCompare(b.path));

function guardedHandlers(
  path: string,
  routeModule: Record<string, unknown>
): Array<(typeof HTTP_METHODS)[number]> {
  const exempt = PUBLIC_BY_DESIGN[path] ?? [];
  return HTTP_METHODS.filter(
    (method) => typeof routeModule[method] === "function" && !exempt.includes(method)
  );
}

function buildContext() {
  return {
    params: Promise.resolve({
      id: "test-id",
      type: "DIGIFLAZZ",
      uid: "test-uid",
      slug: "test-slug",
    }),
  };
}

async function callHandler(
  routeModule: Record<string, unknown>,
  method: (typeof HTTP_METHODS)[number],
  path: string
): Promise<Response> {
  const handler = routeModule[method] as (
    request: NextRequest,
    context: ReturnType<typeof buildContext>
  ) => Promise<Response>;

  return handler(
    new NextRequest(`http://localhost${path}`, { method }),
    buildContext()
  );
}

describe("admin API route guards", () => {
  it("found route files to check", () => {
    // Guards against a broken glob silently turning this suite into a no-op.
    expect(routeModules.length).toBeGreaterThan(40);
  });

  for (const { path, load } of routeModules) {
    it(`${path} refuses anonymous callers with 401`, async () => {
      sessionState.current = {};

      const routeModule = await load();
      const handlers = guardedHandlers(path, routeModule);

      for (const method of handlers) {
        const response = await callHandler(routeModule, method, path);
        expect(
          response.status,
          `${method} ${path} must refuse an anonymous caller with 401`
        ).toBe(401);
      }
    });

    it(`${path} refuses non-admin sessions with 403`, async () => {
      sessionState.current = {
        isLoggedIn: true,
        userId: "member-1",
        role: "MEMBER",
      };

      const routeModule = await load();
      const handlers = guardedHandlers(path, routeModule);

      for (const method of handlers) {
        const response = await callHandler(routeModule, method, path);
        expect(
          response.status,
          `${method} ${path} must refuse a non-admin caller with 403`
        ).toBe(403);
      }
    });
  }
});
