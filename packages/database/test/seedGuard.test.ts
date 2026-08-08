import { describe, it, expect } from "vitest";
import { evaluateSeedGuard, looksLikeProductionEnvironment, assertSeedIsAllowedToRun } from "../src/seedGuard";

describe("looksLikeProductionEnvironment", () => {
  it("is true when NODE_ENV is production", () => {
    expect(looksLikeProductionEnvironment({ NODE_ENV: "production" })).toBe(true);
  });

  it("is true when Netlify's CONTEXT is production, regardless of NODE_ENV", () => {
    expect(looksLikeProductionEnvironment({ NODE_ENV: "development", CONTEXT: "production" })).toBe(true);
  });

  it("is false for ordinary local/dev/test environments", () => {
    expect(looksLikeProductionEnvironment({})).toBe(false);
    expect(looksLikeProductionEnvironment({ NODE_ENV: "development" })).toBe(false);
    expect(looksLikeProductionEnvironment({ NODE_ENV: "test" })).toBe(false);
    expect(looksLikeProductionEnvironment({ CONTEXT: "deploy-preview" })).toBe(false);
    expect(looksLikeProductionEnvironment({ CONTEXT: "branch-deploy" })).toBe(false);
  });
});

describe("evaluateSeedGuard", () => {
  it("refuses by default with no flags set at all -- the original incident's exact starting condition", () => {
    const result = evaluateSeedGuard({});
    expect(result.allowed).toBe(false);
  });

  it("refuses in a non-production environment without the base opt-in flag", () => {
    const result = evaluateSeedGuard({ NODE_ENV: "development" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/ALLOW_DESTRUCTIVE_SEED/);
  });

  it("allows in a non-production environment once the base opt-in flag is set", () => {
    const result = evaluateSeedGuard({ NODE_ENV: "development", ALLOW_DESTRUCTIVE_SEED: "true" });
    expect(result.allowed).toBe(true);
  });

  it("refuses in a production-like environment even with the base flag set, requiring the second flag too", () => {
    const result = evaluateSeedGuard({ NODE_ENV: "production", ALLOW_DESTRUCTIVE_SEED: "true" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/ALLOW_DESTRUCTIVE_SEED_IN_PRODUCTION/);
  });

  it("refuses in a Netlify production CONTEXT even with the base flag set", () => {
    const result = evaluateSeedGuard({ CONTEXT: "production", ALLOW_DESTRUCTIVE_SEED: "true" });
    expect(result.allowed).toBe(false);
  });

  it("allows in a production-like environment only when BOTH flags are set", () => {
    const result = evaluateSeedGuard({
      NODE_ENV: "production",
      ALLOW_DESTRUCTIVE_SEED: "true",
      ALLOW_DESTRUCTIVE_SEED_IN_PRODUCTION: "true",
    });
    expect(result.allowed).toBe(true);
  });

  it("treats any value other than the exact string 'true' as not set (no truthy-string coercion)", () => {
    expect(evaluateSeedGuard({ ALLOW_DESTRUCTIVE_SEED: "1" }).allowed).toBe(false);
    expect(evaluateSeedGuard({ ALLOW_DESTRUCTIVE_SEED: "yes" }).allowed).toBe(false);
    expect(evaluateSeedGuard({ ALLOW_DESTRUCTIVE_SEED: "TRUE" }).allowed).toBe(false);
  });
});

describe("assertSeedIsAllowedToRun", () => {
  it("throws with the guard's reason when not allowed", () => {
    expect(() => assertSeedIsAllowedToRun({})).toThrow(/ALLOW_DESTRUCTIVE_SEED/);
  });

  it("does not throw when allowed", () => {
    expect(() => assertSeedIsAllowedToRun({ ALLOW_DESTRUCTIVE_SEED: "true" })).not.toThrow();
  });
});
