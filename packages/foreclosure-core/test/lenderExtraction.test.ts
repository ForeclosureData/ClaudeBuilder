import { describe, it, expect } from "vitest";
import { extractLenderParties } from "../src/extraction/deterministic/lenderExtraction";

// Regression coverage built from the real recurring Hidalgo notice structures
// found while investigating why the 25-notice bounded production run left
// 83.3% of records missing a lender/beneficiary name. Personal names in
// these fixtures are anonymized (replaced with generic placeholders); the
// surrounding document structure, labels, and OCR noise patterns are
// preserved verbatim since those are what the extractor has to survive.

describe("extractLenderParties", () => {
  it("extracts the original mortgagee via a MERS 'as nominee for X' narrative clause, never MERS itself", () => {
    const text = `
      Deed of Trust dated October 31, 2022, with Jane Borrower, single woman as Grantor(s) and Mortgage Electronic Registration
      Systems, Inc., as beneficiary, as nominee for Example Reliable Lending, LLC, its successors and assigns as Original
      Mortgagee.

      Deed of Trust executed by Jane Borrower securing payment of the indebtedness in the original principal
      amount of $176,641.00. Example Rez LLC is the current mortgagee (the "Mortgagee") of the Note and Deed of Trust or Contract Lien.

      The Mortgage Servicer is authorized to represent the Mortgagee by virtue of a servicing agreement with the
      Mortgagee. Example Point Mortgage Servicing is acting as the Mortgage Servicer for the Mortgagee.
    `;
    const r = extractLenderParties(text);
    expect(r.originalMortgagee.value).toBe("Example Reliable Lending, LLC");
    expect(r.currentMortgagee.value).toBe("Example Rez LLC");
    expect(r.mortgageServicer.value).toBe("Example Point Mortgage Servicing");
    // Distinct parties, never collapsed.
    expect(r.originalMortgagee.value).not.toBe(r.currentMortgagee.value);
    expect(r.currentMortgagee.value).not.toBe(r.mortgageServicer.value);
  });

  it("tolerates OCR misspellings of 'current mortgagee' ('curren murigagee', 'cument mortgagee')", () => {
    const r1 = extractLenderParties("Example Rocket Corp is the curren murigagee of the note and deed of trust.");
    expect(r1.currentMortgagee.value).toBe("Example Rocket Corp");

    const r2 = extractLenderParties("Example Chase Bank, National Association is the cument mortgagee of the note and Deed of Trust.");
    expect(r2.currentMortgagee.value).toBe("Example Chase Bank, National Association");
  });

  it("tolerates an OCR-garbled label ('Current Mortgagoe:' for 'Current Mortgagee:')", () => {
    const r = extractLenderParties("Current Mortgagoe: Example Bank, National Association\nMortgagee Address: 123 Main St");
    expect(r.currentMortgagee.value).toBe("Example Bank, National Association");
  });

  it("extracts a servicer named via 'X, as Mortgage Servicer, is representing the current mortgagee'", () => {
    const text = `Example Mortgage, A Division of Example Bank. as Mortgage Servicer, is
      representing the current mortgagee, whose address is:`;
    const r = extractLenderParties(text);
    expect(r.mortgageServicer.value).toBe("Example Mortgage, A Division of Example Bank");
  });

  it("extracts current mortgagee from a table row where OCR bled the beneficiary column onto the servicer row ('Current X Loan Servicer: Y')", () => {
    const text = `
      Trustor(s): Jane Doe Original MORTGAGE ELECTRONIC
      Beneficiary: REGISTRATION SYSTEMS,
      INC. ("MERS"), AS
      BENEFICIARY, AS NOMINEE
      FOR Example Movement Mortgage,
      LLC ITS SUCCESSORS AND
      ASSIGNS
      Current Example Movement Mortgage, LLC Loan Servicer: ~~ Example Service Co, LLC
    `;
    const r = extractLenderParties(text);
    expect(r.originalMortgagee.value).toBe("Example Movement Mortgage, LLC");
    expect(r.currentMortgagee.value).toBe("Example Movement Mortgage, LLC");
    expect(r.mortgageServicer.value).toBe("Example Service Co, LLC");
  });

  it("does not let a lazy capture swallow a whole grantor-conveyance clause ('...WIFE to JANE DOE...WIFE. X is the current owner')", () => {
    const text = `
      any and all present and future indebtedness of JANE DOE AND JOHN DOE, HUSBAND AND
      WIFE to JANE DOE AND JOHN DOE, HUSBAND AND WIFE.
      Example Movement Mortgage, LLC is the current owner and holder of the Obligations and is the beneficiary under
      the Deed of Trust.
    `;
    const r = extractLenderParties(text);
    expect(r.currentMortgagee.value).toBe("Example Movement Mortgage, LLC");
  });

  it("does not cross a real sentence boundary into a second name ('Jane Doe. NAME is the current mortgagee')", () => {
    const text = `executed by Jane Doe. Example NewCo LLC is the current mortgagee (the "Mortgagee") of the Note and Deed of Trust.`;
    const r = extractLenderParties(text);
    expect(r.currentMortgagee.value).toBe("Example NewCo LLC");
  });

  it("tolerates OCR misreading a comma as a period before a company suffix ('X. LLC' for 'X, LLC')", () => {
    const text = `Mortgage Servicer: Mortgage Servicer's Address:
      Example Home Lending. LLC is representing the Current 123 Research Parkway.`;
    const r = extractLenderParties(text);
    expect(r.mortgageServicer.value).toBe("Example Home Lending. LLC");
  });

  it("extracts a long trust/certificate-series entity name spanning many commas", () => {
    const text = `EXAMPLE BANK NATIONAL TRUST COMPANY, AS TRUSTEE FOR SAMPLE ASSET SECURITIES
      TRUST 2006-2 MORTGAGE LOAN ASSET BACKED CERTIFICATES, SERIES 2006-2 is the
      current mortgagee of the note and deed of trust or contract lien.`;
    const r = extractLenderParties(text);
    expect(r.currentMortgagee.value).toBe(
      "EXAMPLE BANK NATIONAL TRUST COMPANY, AS TRUSTEE FOR SAMPLE ASSET SECURITIES TRUST 2006-2 MORTGAGE LOAN ASSET BACKED CERTIFICATES, SERIES 2006-2",
    );
  });

  it("recognizes 'Lender:' and 'Current Beneficiary:' as alternate labels for the current mortgagee/lender concept", () => {
    const r1 = extractLenderParties("Grantor: Jane Doe, a single person\nLender: Example Investments, LLC");
    expect(r1.currentMortgagee.value).toBe("Example Investments, LLC");

    const r2 = extractLenderParties("Current Beneficiary: Example Investments, LLC\n\nCurrent Beneficiary has appointed a Trustee.");
    expect(r2.currentMortgagee.value).toBe("Example Investments, LLC");
  });

  it("rejects garbage: a bare generic word, a trustee/auction company, a street address, and a column-header label", () => {
    expect(extractLenderParties("Current Mortgagee: Mortgagee").currentMortgagee.value).toBeNull();
    expect(extractLenderParties("Current Mortgagee: Auction.com, LLC").currentMortgagee.value).toBeNull();
    expect(extractLenderParties("Current Mortgagee: 123 Main St, Houston, TX 77070").currentMortgagee.value).toBeNull();
    expect(
      extractLenderParties("Original Beneficiary/Mortgagee: Current Beneficiary/Mortgagee:\nsome unrelated line").originalMortgagee.value,
    ).toBeNull();
  });

  it("rejects a heading continuation ('...MORTGAGE SERVICER INFORMATION') instead of treating 'INFORMATION' as a servicer name", () => {
    const text = "INSTRUMENT BEING FORECLOSED AND MORTGAGE SERVICER INFORMATION\n\nDeed of Trust dated October 31, 2022...";
    const r = extractLenderParties(text);
    expect(r.mortgageServicer.value).toBeNull();
  });

  it("returns null for all three fields when the notice states none of them", () => {
    const r = extractLenderParties("Notice of Trustee's Sale. Sale Date: 08/04/2026. No further party information stated.");
    expect(r.originalMortgagee.value).toBeNull();
    expect(r.currentMortgagee.value).toBeNull();
    expect(r.mortgageServicer.value).toBeNull();
  });
});
