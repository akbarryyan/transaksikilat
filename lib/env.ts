/**
 * Boot-time validation for the variables the app cannot run without.
 *
 * Only genuinely mandatory values are listed. Provider and SMTP credentials
 * are deliberately excluded: the app serves fine without them and only the
 * matching feature degrades, so failing to boot over them would be wrong.
 */

type Env = Record<string, string | undefined>;

const REQUIRED = ["DATABASE_URL", "SESSION_SECRET"] as const;

/** iron-session refuses to seal a cookie with a shorter secret. */
const MIN_SESSION_SECRET_LENGTH = 32;

export function validateEnv(env: Env = process.env): string[] {
  const problems: string[] = [];

  for (const key of REQUIRED) {
    if (!env[key]?.trim()) {
      problems.push(`${key} is missing`);
    }
  }

  const sessionSecret = env.SESSION_SECRET ?? "";
  if (sessionSecret.trim() && sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    problems.push(
      `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters, got ${sessionSecret.length}`
    );
  }

  return problems;
}

export function assertEnv(env: Env = process.env): void {
  const problems = validateEnv(env);
  if (problems.length === 0) return;

  throw new Error(
    `Invalid environment configuration:\n  - ${problems.join("\n  - ")}\n` +
      `See .env.example for the full list of variables.`
  );
}
