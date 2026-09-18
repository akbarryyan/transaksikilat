import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const FALLBACK_SESSION_SECRET = "test-session-secret-at-least-32-characters";

/**
 * Never let a misconfigured env point the suite at a dev or production
 * database — every test run truncates tables.
 */
function assertTestDatabase(): void {
  const dbName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to run: test database name must end with '_test', got '${dbName}'.`
    );
  }
}

function toTestDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, "");
  if (!name) throw new Error("DATABASE_URL has no database name");
  parsed.pathname = `/${name.endsWith("_test") ? name : `${name}_test`}`;
  return parsed.toString();
}

function loadEnv(): void {
  // An explicit DATABASE_URL wins, which is how CI hands over its service
  // container. Then .env.test, then .env.local with '_test' appended to the
  // database name so a fresh clone needs no extra file to run the suite.
  if (process.env.DATABASE_URL?.trim()) {
    assertTestDatabase();
    process.env.SESSION_SECRET ||= FALLBACK_SESSION_SECRET;
    return;
  }

  const explicit = resolve(ROOT, ".env.test");
  if (existsSync(explicit)) {
    Object.assign(process.env, parseEnvFile(explicit));
  } else {
    const local = resolve(ROOT, ".env.local");
    if (!existsSync(local)) {
      throw new Error(
        "Tests need a database: create .env.test, or .env.local with a DATABASE_URL (its database name gets '_test' appended)."
      );
    }
    const vars = parseEnvFile(local);
    if (!vars.DATABASE_URL) {
      throw new Error(".env.local has no DATABASE_URL");
    }
    vars.DATABASE_URL = toTestDatabaseUrl(vars.DATABASE_URL);
    Object.assign(process.env, vars);
  }

  assertTestDatabase();

  // Vitest already sets NODE_ENV=test.
  process.env.SESSION_SECRET ||= FALLBACK_SESSION_SECRET;
}

loadEnv();
