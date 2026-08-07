import { describe, it, expect } from "vitest";
import { getValuationProviders } from "./index";
import { ZillowAuthorizedProvider } from "./zillow";
import { LicensedThirdPartyAvmProvider } from "./thirdPartyAvm";

describe("getValuationProviders", () => {
  it("MVP: includes only the two county providers, excludes Zillow/third-party AVM/internal estimate entirely (not just via env flags)", () => {
    delete process.env.ZILLOW_API_ENABLED;
    delete process.env.THIRD_PARTY_AVM_ENABLED;

    const keys = getValuationProviders().map((p) => p.providerKey);
    expect(keys).toContain("county_appraisal_market");
    expect(keys).toContain("county_appraisal_appraised");
    expect(keys).not.toContain("internal_estimate");
    expect(keys).not.toContain("zillow");
    expect(keys).not.toContain("third_party_avm");
  });

  it("MVP: still excludes Zillow/third-party AVM even if their env flags are explicitly enabled", () => {
    process.env.ZILLOW_API_ENABLED = "true";
    process.env.THIRD_PARTY_AVM_ENABLED = "true";
    try {
      const keys = getValuationProviders().map((p) => p.providerKey);
      expect(keys).not.toContain("zillow");
      expect(keys).not.toContain("third_party_avm");
    } finally {
      delete process.env.ZILLOW_API_ENABLED;
      delete process.env.THIRD_PARTY_AVM_ENABLED;
    }
  });
});

describe("ZillowAuthorizedProvider", () => {
  it("always resolves null while ZILLOW_API_ENABLED is unset or false — no HTTP call is reachable", async () => {
    delete process.env.ZILLOW_API_ENABLED;
    const provider = new ZillowAuthorizedProvider();
    await expect(provider.getValuation({ propertyId: "p1", streetAddress: "123 Main St" })).resolves.toBeNull();

    process.env.ZILLOW_API_ENABLED = "false";
    await expect(provider.getValuation({ propertyId: "p1" })).resolves.toBeNull();
  });
});

describe("LicensedThirdPartyAvmProvider", () => {
  it("always resolves null while THIRD_PARTY_AVM_ENABLED is unset or false", async () => {
    delete process.env.THIRD_PARTY_AVM_ENABLED;
    const provider = new LicensedThirdPartyAvmProvider();
    await expect(provider.getValuation({ propertyId: "p1" })).resolves.toBeNull();

    process.env.THIRD_PARTY_AVM_ENABLED = "false";
    await expect(provider.getValuation({ propertyId: "p1" })).resolves.toBeNull();
  });
});
