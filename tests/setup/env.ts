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

function toTestDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, "");
  if (!name) throw new Error("DATABASE_URL has no database name");
  parsed.pathname = `/${name.endsWith("_test") ? name : `${name}_test`}`;
  return parsed.toString();
}

function loadEnv(): void {
  // .env.test wins when present; otherwise derive from .env.local so a fresh
  // clone needs no extra file to run the suite.
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

  // Never let a misconfigured env point the suite at a dev or production
  // database — every test run truncates tables.
  const dbName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to run: test database name must end with '_test', got '${dbName}'.`
    );
  }

  // Vitest already sets NODE_ENV=test.
  process.env.SESSION_SECRET ||= "test-session-secret-at-least-32-characters";
}

loadEnv();
