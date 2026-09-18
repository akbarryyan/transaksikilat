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

  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const { table_name } of rows) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table_name}\``);
    }
  } finally {
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
  }
}
