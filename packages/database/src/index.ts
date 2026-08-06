import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __ftiPrisma: PrismaClient | undefined;
}

/**
 * On Netlify, with no DATABASE_URL configured (e.g. a project's own Supabase
 * Postgres hasn't been set up yet), fall back to Netlify's own auto-provisioned
 * Postgres via `@netlify/database`. A real DATABASE_URL (Supabase or otherwise)
 * always takes precedence — this only fires when one hasn't been set.
 */
if (!process.env.DATABASE_URL && process.env.NETLIFY) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getConnectionString } = require("@netlify/database") as typeof import("@netlify/database");
    const connectionString = getConnectionString();
    if (connectionString) {
      process.env.DATABASE_URL = connectionString;
      process.env.DIRECT_URL ??= connectionString;
    }
  } catch {
    // @netlify/database not usable in this context — leave DATABASE_URL unset,
    // Prisma will throw its normal "Environment variable not found" error.
  }
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
