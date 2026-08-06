import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __ftiPrisma: PrismaClient | undefined;
}

/**
 * With no DATABASE_URL configured (e.g. a project's own Supabase Postgres
 * hasn't been set up yet), fall back to Netlify's own auto-provisioned
 * Postgres via `@netlify/database`, when available. A real DATABASE_URL
 * (Supabase or otherwise) always takes precedence — this only fires when one
 * hasn't been set. Deliberately not gated on `process.env.NETLIFY`: that's
 * reliably set during Netlify's build but not guaranteed inside the deployed
 * function's own runtime, where this fallback matters just as much — the
 * try/catch is what makes this safe to attempt unconditionally (it no-ops
 * cleanly anywhere else, e.g. local dev).
 */
if (!process.env.DATABASE_URL) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getConnectionString } = require("@netlify/database") as typeof import("@netlify/database");
    const connectionString = getConnectionString();
    if (connectionString) {
      process.env.DATABASE_URL = connectionString;
      process.env.DIRECT_URL ??= connectionString;
    }
  } catch {
    // Not resolvable in this context — leave DATABASE_URL unset, Prisma will
    // throw its normal "Environment variable not found" error.
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
