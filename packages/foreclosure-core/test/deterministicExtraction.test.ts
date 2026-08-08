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

  // Regression coverage for a real production bug: the bare (unlabeled)
  // fallback matched the FIRST address-shaped string anywhere in the
  // document with no anchor, and several real Hidalgo templates state the
  // county courthouse's auction address (or a trustee's/attorney's mailing
  // address) *before* any real property reference -- confirmed live to have
  // published the courthouse address as the property's own address on 5 of
  // 24 real records. None of these fixtures state a real property address
  // anywhere, so the correct result is null (falls through to
  // legal-description-based CAD resolution), not a wrong address.
  it("never returns the Hidalgo County Administrative Building's auction address", () => {
    const text = `Location of Sale: The place of the sale shall be: HIDALGO County Courthouse, Texas at the following
      location: The Hidalgo County Administrative Building, located at 2802 S. Business Hwy 281, Edinburg, TX 78539
      (outdoor covered area on the west side of the building).`;
    expect(detectStatedPropertyAddress(text)).toBeNull();
  });

  it("tolerates OCR noise in the courthouse address ('5.' or '§.' for 'S.')", () => {
    expect(detectStatedPropertyAddress("2802 5. BUSINESS HWY 281. EDINBURG, TX 78539")).toBeNull();
    expect(detectStatedPropertyAddress("2802 §. BUSINESS HWY 281, EDINBURG, TX 78539")).toBeNull();
  });

  it("never returns a substitute trustee's mailing address ('appointed X, located at Y')", () => {
    const text = `the undersigned attorney for the mortgage servicer has named and appointed, and by these presents
      does name and appoint Example Title Services, LLC, located at 5177 Example Avenue Suite 1230, Houston, TX 77056,
      Substitute Trustee to act under and by virtue of said Deed of Trust.`;
    expect(detectStatedPropertyAddress(text)).toBeNull();
  });

  it("never returns an attorney signature block's office address", () => {
    const text = `Jane Doe, Attorney at Law
      Example Office Center, Suite 300
      14160 Example Parkway
      Dallas, TX 73254`;
    expect(detectStatedPropertyAddress(text)).toBeNull();
  });

  it("still finds a real property address stated earlier in the same document that also contains a trustee address later", () => {
    const text = `Property Address: 123 Real St, Edinburg, TX 78539\n\nlater in the document: Example Trustee Co, located at 999 Other Ave, Houston, TX 77056.`;
    const result = detectStatedPropertyAddress(text);
    expect(result?.text).toContain("123 Real St");
  });

  it("does not let a document-number header ('Doc-117660') masquerade as a house number", () => {
    const text = "Doc-117660\n309 S Paseo Del Rey St 00000010828390\nMission, TX 78572";
    const result = detectStatedPropertyAddress(text);
    expect(result?.text).toContain("309 S Paseo Del Rey St");
    expect(result?.text).not.toContain("117660");
  });

  it("does not start a house number mid-way through a longer tracking/ID digit run", () => {
    const text = "Certificate of Posting: 260000404531 7 3113 HST Mcallen, TX 78503";
    const result = detectStatedPropertyAddress(text);
    // Either null (correctly rejected as unreliable) or, if matched, never starting with the barcode's tail digits.
    if (result) expect(result.text.startsWith("404531")).toBe(false);
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

// The fixtures below mirror real structural patterns confirmed against
// the first 5 real Hidalgo production notices (August 2026 postings) --
// but use placeholder names, not the real borrower names, since this file
// is committed to a public repo. See texasTemplates.ts's extractGrantorNames
// doc comment for the full rationale.
describe("extractDeterministic (real-world Hidalgo grantor templates)", () => {
  it("extracts grantor names from a 'Trustor(s):' table label plus a redundant 'executed by' sentence, filtering the marital-status suffix", () => {
    const notice = `NOTICE OF SUBSTITUTE TRUSTEE SALE
Property Address: 123 Sample St, Pharr, Texas 78577
Trustor(s): JOHN A. SAMPLE Original MORTGAGE ELECTRONIC
AND MARY B. SAMPLE Beneficiary: REGISTRATION SYSTEMS, INC.

...pursuant to the power of the sale granted by the deed of trust executed by JOHN A. SAMPLE AND
MARY B. SAMPLE, HUSBAND AND WIFE. The real property and personal property encumbered by the
deed of trust will be sold at the sale.
Date of Sale: September 1, 2026`;
    const result = extractDeterministic(notice);
    expect(result.borrowerNames.value).toEqual(["JOHN A. SAMPLE", "MARY B. SAMPLE"]);
    // Marital-status descriptors must never be fabricated into names.
    expect(result.borrowerNames.value).not.toContain("HUSBAND");
    expect(result.borrowerNames.value).not.toContain("WIFE");
  });

  it("extracts a single grantor from an 'Obligation Secured... executed by NAME secures' sentence with no label at all", () => {
    const notice = `NOTICE OF SUBSTITUTE TRUSTEE SALE
Obligation Secured: The Deed of Trust executed by PATRICIA C. SAMPLE secures the repayment of a Note
dated November 30, 2017 in the amount of $88,712.00.
Date of Sale: September 1, 2026`;
    const result = extractDeterministic(notice);
    expect(result.borrowerNames.value).toEqual(["PATRICIA C. SAMPLE"]);
  });

  it("extracts grantor names from a label sitting alone on its own line, with the name on the next line after a garbled OCR date token", () => {
    const notice = `Doc-999999
NOTICE OF SUBSTITUTE TRUSTEE SALE
Deed of Trust Date: Grantor(s)/Mortgagor(s):
121202018 CARLOS D. SAMPLE AND ELENA F. SAMPLE
HUSBAND AND WIFE
Original Beneficiary: MORTGAGE ELECTRONIC REGISTRATION SYSTEMS
Date of Sale: September 1, 2026`;
    const result = extractDeterministic(notice);
    expect(result.borrowerNames.value).toEqual(["CARLOS D. SAMPLE", "ELENA F. SAMPLE"]);
  });

  it("filters per-person marital-status descriptors (AN UNMARRIED MAN / AN UNMARRIED WOMAN) rather than treating them as extra grantors", () => {
    const notice = `NOTICE OF SUBSTITUTE TRUSTEE SALE
...granted by the deed of trust executed by DAVID G. SAMPLE, AN UNMARRIED MAN AND
LISA H. SAMPLE, AN UNMARRIED WOMAN. The real property and personal property
encumbered by the deed of trust will be sold at the sale.
Date of Sale: September 1, 2026`;
    const result = extractDeterministic(notice);
    expect(result.borrowerNames.value).toEqual(["DAVID G. SAMPLE", "LISA H. SAMPLE"]);
  });

  it("extracts sale date from a 'Sale Information:' line, ignoring an earlier unrelated 'dated' occurrence that could be mistaken for a date label", () => {
    const notice = `NOTICE OF SUBSTITUTE TRUSTEE SALE
Obligation Secured: The Deed of Trust executed by PATRICIA C. SAMPLE secures the repayment of a Note
dated November 30, 2017 in the amount of $88,712.00.
Sale Information: August 4, 2026, at 10:00 AM, or not later than three hours thereafter, at the Hidalgo
County Administrative Building.`;
    const result = extractDeterministic(notice);
    expect(result.saleDate.value).toBe("2026-08-04");
  });

  it("still returns null rather than guessing when no recognizable grantor phrasing is present", () => {
    const notice = `NOTICE OF SUBSTITUTE TRUSTEE SALE
Property Address: 456 Sample Ave, Pharr, Texas 78577
Date of Sale: September 1, 2026`;
    const result = extractDeterministic(notice);
    expect(result.borrowerNames.value).toBeNull();
    expect(result.borrowerNames.confidence).toBe(0);
  });
});
