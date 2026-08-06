import { PrismaClient } from "@prisma/client";
import { getConnectionString } from "@netlify/database";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";

declare global {
  // eslint-disable-next-line no-var
  var __ftiPrisma: PrismaClient | undefined;
}

neonConfig.webSocketConstructor = ws;

/**
 * With no DATABASE_URL configured (e.g. a project's own Supabase Postgres
 * hasn't been set up yet), fall back to Netlify's own auto-provisioned
 * Postgres (Neon) via `@netlify/database`, when available. A real
 * DATABASE_URL (Supabase or otherwise) always takes precedence — this only
 * fires when one hasn't been set. Deliberately not gated on
 * `process.env.NETLIFY`: that's reliably set during Netlify's build but not
 * guaranteed inside the deployed function's own runtime, where this fallback
 * matters just as much — the try/catch is what makes this safe to attempt
 * unconditionally (it no-ops cleanly anywhere else, e.g. local dev).
 */
let usingNetlifyFallbackDb = false;
if (!process.env.DATABASE_URL) {
  try {
    const connectionString = getConnectionString();
    if (connectionString) {
      process.env.DATABASE_URL = connectionString;
      process.env.DIRECT_URL ??= connectionString;
      usingNetlifyFallbackDb = true;
    }
  } catch {
    // Not resolvable in this context — leave DATABASE_URL unset, Prisma will
    // throw its normal "Environment variable not found" error.
  }
}

/**
 * Neon (which powers the Netlify fallback DB above) is a "serverless"
 * Postgres reached over HTTP/WebSocket rather than a plain TCP socket —
 * Prisma's normal native-binary engine is unreliable for that combination
 * inside a Lambda-style function. Prisma's own driver-adapter for Neon
 * avoids the native binary entirely, so it's used only on that fallback
 * path; a real DATABASE_URL (Supabase Postgres etc.) keeps using Prisma's
 * standard engine as normal.
 */
function createPrismaClient(): PrismaClient {
  const log = process.env.NODE_ENV === "development" ? (["warn", "error"] as const) : (["error"] as const);
  if (usingNetlifyFallbackDb) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaNeon(pool);
    return new PrismaClient({ adapter, log: [...log] });
  }
  return new PrismaClient({ log: [...log] });
}

/**
 * Single Prisma client per process. In Next.js dev, the module cache is
 * reset on every edit, so we stash the instance on `global` to avoid
 * exhausting Postgres connections via hot reload.
 */
export const prisma: PrismaClient = global.__ftiPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__ftiPrisma = prisma;
}

export * from "@prisma/client";
