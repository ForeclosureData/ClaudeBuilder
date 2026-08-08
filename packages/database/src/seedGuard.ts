/**
 * Defense-in-depth guard for `prisma/seed.ts`. This is the SECOND layer of
 * protection against accidentally destroying real data -- the FIRST layer
 * is that the production build (netlify.toml) no longer invokes `db:seed`
 * at all. This guard exists so that even if something calls the seed
 * script directly against a production-like environment (a mistyped local
 * command, a future CI job, a human running it by hand against the wrong
 * DATABASE_URL), it still refuses without an explicit, deliberate opt-in.
 *
 * Two separate flags are required to run against anything that looks like
 * production, on purpose -- a single flag is too easy to leave set in a
 * shared shell/CI config by accident:
 *   - ALLOW_DESTRUCTIVE_SEED=true            (required in every environment)
 *   - ALLOW_DESTRUCTIVE_SEED_IN_PRODUCTION=true  (required ONLY when the
 *     environment looks production-like, on top of the flag above)
 */

export interface SeedGuardEnv {
  ALLOW_DESTRUCTIVE_SEED?: string;
  ALLOW_DESTRUCTIVE_SEED_IN_PRODUCTION?: string;
  NODE_ENV?: string;
  CONTEXT?: string;
  NETLIFY?: string;
}

export interface SeedGuardResult {
  allowed: boolean;
  reason: string;
}

/**
 * True when the environment carries any signal that this is a production
 * deploy context -- Next.js/most build tools set NODE_ENV=production for
 * any optimized build (not just Netlify's), and Netlify additionally sets
 * CONTEXT=production specifically for its production deploy context. Either
 * signal alone is treated as "assume production" -- erring conservative
 * here is the entire point of this guard.
 */
export function looksLikeProductionEnvironment(env: SeedGuardEnv): boolean {
  if (env.NODE_ENV === "production") return true;
  if (env.CONTEXT === "production") return true;
  return false;
}

export function evaluateSeedGuard(env: SeedGuardEnv): SeedGuardResult {
  if (env.ALLOW_DESTRUCTIVE_SEED !== "true") {
    return {
      allowed: false,
      reason:
        "Refusing to run: this script deletes existing Hidalgo foreclosure data (cases, documents, properties, " +
        "manual review tasks, people/organizations) before reseeding fixtures. Set ALLOW_DESTRUCTIVE_SEED=true to " +
        "run it deliberately. Never set this in the production deploy environment -- see docs/DEPLOYMENT.md.",
    };
  }

  if (looksLikeProductionEnvironment(env) && env.ALLOW_DESTRUCTIVE_SEED_IN_PRODUCTION !== "true") {
    return {
      allowed: false,
      reason:
        "Refusing to run: this environment looks production-like (NODE_ENV or CONTEXT is \"production\"). " +
        "ALLOW_DESTRUCTIVE_SEED=true alone is not enough here -- also set ALLOW_DESTRUCTIVE_SEED_IN_PRODUCTION=true " +
        "if you are certain you want to delete and reseed PRODUCTION Hidalgo data. Read the incident writeup in " +
        "docs/DEPLOYMENT.md before setting this.",
    };
  }

  return { allowed: true, reason: "ALLOW_DESTRUCTIVE_SEED=true (and ALLOW_DESTRUCTIVE_SEED_IN_PRODUCTION=true if production-like)." };
}

/** Throws with the guard's reason when not allowed; call this at the very top of seed.ts's main(), before any Prisma calls. */
export function assertSeedIsAllowedToRun(env: SeedGuardEnv = process.env): void {
  const result = evaluateSeedGuard(env);
  if (!result.allowed) {
    throw new Error(result.reason);
  }
}
