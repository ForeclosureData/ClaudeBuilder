import { describe, it, expect } from "vitest";
import { getValuationProviders } from "./index";
import { ZillowAuthorizedProvider } from "./zillow";
import { LicensedThirdPartyAvmProvider } from "./thirdPartyAvm";

describe("getValuationProviders", () => {
  it("includes county appraisal + internal estimate, excludes Zillow/third-party AVM when no flags are set", () => {
    delete process.env.ZILLOW_API_ENABLED;
    delete process.env.THIRD_PARTY_AVM_ENABLED;

    const keys = getValuationProviders().map((p) => p.providerKey);
    expect(keys).toContain("county_appraisal");
    expect(keys).toContain("internal_estimate");
    expect(keys).not.toContain("zillow");
    expect(keys).not.toContain("third_party_avm");
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
