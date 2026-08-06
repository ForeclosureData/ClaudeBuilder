import { describe, it, expect } from "vitest";
import { parseCurrencyToCents, findAllCurrencyAmountsCents } from "../src/extraction/deterministic/currency";
import { parseFirstDate, parseLabeledDate, parseLabeledTime } from "../src/extraction/deterministic/dates";
import { detectStatedPropertyAddress } from "../src/extraction/deterministic/addresses";
import { parseLegalDescription } from "../src/extraction/deterministic/legalDescription";
import { extractDeterministic, needsAiFallback } from "../src/extraction/deterministic/texasTemplates";

describe("parseCurrencyToCents", () => {
  it("parses a plain dollar amount to cents", () => {
    expect(parseCurrencyToCents("$185,000.00")).toBe(18_500_000);
  });
  it("parses an amount without cents", () => {
    expect(parseCurrencyToCents("Original Principal Amount: $211,400.00")).toBe(21_140_000);
  });
  it("returns null when no amount is present", () => {
    expect(parseCurrencyToCents("no dollar figure here")).toBeNull();
  });
  it("rejects a zero or negative-looking amount", () => {
    expect(parseCurrencyToCents("$0.00")).toBeNull();
  });
});

describe("findAllCurrencyAmountsCents", () => {
  it("finds every amount in reading order", () => {
    const amounts = findAllCurrencyAmountsCents("Principal $100,000.00 and balance $95,500.50");
    expect(amounts).toEqual([10_000_000, 9_550_050]);
  });
});

describe("date parsing", () => {
  it("parses a long-form date", () => {
    expect(parseFirstDate("September 1, 2026")).toBe("2026-09-01");
  });
  it("parses a numeric date", () => {
    expect(parseFirstDate("09/01/2026")).toBe("2026-09-01");
  });
  it("finds a labeled date within a window", () => {
    const text = "Date of Sale: September 1, 2026\nTime of Sale: 10:00 AM";
    expect(parseLabeledDate(text, /Date of Sale:?/i)).toBe("2026-09-01");
  });
  it("finds a labeled time", () => {
    const text = "Time of Sale: 10:00 AM or within three hours thereafter";
    expect(parseLabeledTime(text, /Time of Sale:?/i)).toBe("10:00 AM");
  });
  it("rejects an out-of-range month/day", () => {
    expect(parseFirstDate("13/45/2026")).toBeNull();
  });
});

describe("detectStatedPropertyAddress", () => {
  it("extracts an address after a Property Address label", () => {
    const result = detectStatedPropertyAddress("Property Address: 3312 W Trenton Rd, Edinburg, Texas 78539\n(informational only)");
    expect(result?.method).toBe("EXPLICIT_STATED");
    expect(result?.text).toContain("3312 W Trenton Rd");
  });
  it("extracts an address from a commonly known as phrase", () => {
    const result = detectStatedPropertyAddress("commonly known as 900 S 10th St, McAllen, Texas 78501 is described as follows");
    expect(result?.method).toBe("COMMONLY_KNOWN_AS_PHRASE");
    expect(result?.text).toContain("900 S 10th St");
  });
  it("returns null when no address-shaped text is present", () => {
    expect(detectStatedPropertyAddress("Lot 22, Palms Estates, Hidalgo County")).toBeNull();
  });
});

describe("parseLegalDescription", () => {
  it("extracts lot, block, and subdivision", () => {
    const result = parseLegalDescription(
      "Legal Description: Lot 8, Block 2, PALM VALLEY ESTATES SUBDIVISION, an addition to Hidalgo County, Texas.\n\nOriginal Principal Amount: $1",
    );
    expect(result?.lot).toBe("8");
    expect(result?.block).toBe("2");
    expect(result?.subdivision).toContain("PALM VALLEY ESTATES SUBDIVISION");
  });
  it("falls back to a bare Lot/Block sentence when there is no labeled block", () => {
    const result = parseLegalDescription("...ot 22, ... PALMS ESTATES, Hidalgo Cnty Tx ... Lot 22, Block 1 more text here");
    expect(result).not.toBeNull();
  });
});

describe("extractDeterministic (full notice)", () => {
  const sampleNotice = `NOTICE OF SUBSTITUTE TRUSTEE'S SALE

Deed of Trust Date: April 3, 2019
Grantor: CARLOS E. VELA AND ANA M. VELA
Current Mortgagee: Rio Bravo Home Loans, LLC

Property Address: 3312 W Trenton Rd, Edinburg, Texas 78539

Legal Description: Lot 8, Block 2, PALM VALLEY ESTATES SUBDIVISION, Hidalgo County, Texas.

Original Principal Amount: $211,400.00

Substitute Trustee: Gilbert A. Sosa

Date of Sale: September 1, 2026
Time of Sale: 10:00 AM
Place of Sale: Hidalgo County Courthouse, Edinburg, Texas.`;

  it("extracts every high-confidence field from a well-formed notice", () => {
    const result = extractDeterministic(sampleNotice);
    expect(result.borrowerNames.value).toEqual(["CARLOS E. VELA", "ANA M. VELA"]);
    expect(result.lenderName.value).toBe("Rio Bravo Home Loans, LLC");
    expect(result.propertyAddress.value).toContain("3312 W Trenton Rd");
    expect(result.saleDate.value).toBe("2026-09-01");
    expect(result.saleTime.value).toBe("10:00 AM");
    expect(result.originalPrincipalAmount.value).toBe(211400);
    expect(result.originalPrincipalAmount.explicitlyStated).toBe(true);
  });

  it("never invents a current balance when none is stated", () => {
    const result = extractDeterministic(sampleNotice);
    expect(result.currentPrincipalBalance.value).toBeNull();
    expect(result.currentPrincipalBalance.explicitlyStated).toBe(false);
  });

  it("flags a sparse/poor-quality notice as needing AI fallback", () => {
    const poorNotice = "N0TICE 0F SALE\nDate 0f Sale: 09/01/2026\n[most fields illegible]";
    const result = extractDeterministic(poorNotice);
    expect(needsAiFallback(result)).toBe(true);
  });

  it("does not flag a complete, high-confidence notice as needing AI fallback", () => {
    const result = extractDeterministic(sampleNotice);
    expect(needsAiFallback(result)).toBe(false);
  });
});
