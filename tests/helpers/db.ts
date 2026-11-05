import { prisma } from "@/src/infra/db/prisma";

export { prisma };

/**
 * Truncates every application table. The env setup already refuses to run
 * against a database whose name does not end with `_test`.
 */
export async function resetDatabase(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name AS table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
  `;

  // FOREIGN_KEY_CHECKS is per-connection. Without pinning, the pool can hand
  // TRUNCATE a different connection than the one SET ran on, which fails with
  // error 1701 intermittently. An interactive transaction holds one connection.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
      try {
        for (const { table_name } of rows) {
          await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${table_name}\``);
        }
      } finally {
        await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
      }
    },
    { timeout: 60_000 }
  );
}
