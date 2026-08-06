import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __ftiPrisma: PrismaClient | undefined;
}

/**
 * Single Prisma client per process. In Next.js dev, the module cache is
 * reset on every edit, so we stash the instance on `global` to avoid
 * exhausting Postgres connections via hot reload.
 */
export const prisma: PrismaClient =
  global.__ftiPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__ftiPrisma = prisma;
}

export * from "@prisma/client";
