import { PrismaClient } from '@prisma/client';

// Prisma owns APPLICATION STATE ONLY (threads, messages, tool-call
// timeline, approvals mirror) in Snowflake Postgres. It never reads the
// supply chain tables or the semantic view - that is the Snowflake
// driver's job, so the semantic view remains the single source of truth.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
