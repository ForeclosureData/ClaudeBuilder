import { describe, it, expect } from "vitest";
import {
  parseCoverSheetBarcode,
  detectDocumentBoundaries,
  boundariesToNoticeRanges,
  type BarcodeScanner,
} from "../src/hidalgo/barcodeSplit";

describe("parseCoverSheetBarcode", () => {
  it("extracts the document number from a real Hidalgo cover-sheet barcode", () => {
    expect(parseCoverSheetBarcode("VG-705-2026-117631")).toEqual({ documentNumber: "117631" });
  });

  it("extracts distinct document numbers from consecutive real postings", () => {
    expect(parseCoverSheetBarcode("VG-705-2026-117630")).toEqual({ documentNumber: "117630" });
    expect(parseCoverSheetBarcode("VG-705-2026-117632")).toEqual({ documentNumber: "117632" });
  });

  it("tolerates surrounding whitespace from OCR/zbar decode noise", () => {
    expect(parseCoverSheetBarcode("  VG-705-2026-117631  ")).toEqual({ documentNumber: "117631" });
  });

  it("returns null for barcode text that doesn't match the cover-sheet format", () => {
    expect(parseCoverSheetBarcode("")).toBeNull();
    expect(parseCoverSheetBarcode("random-garbage")).toBeNull();
    expect(parseCoverSheetBarcode("123456789012")).toBeNull(); // e.g. a UPC on an unrelated page
    expect(parseCoverSheetBarcode("VG-705-26-117631")).toBeNull(); // year must be 4 digits
    expect(parseCoverSheetBarcode("VG-705-2026-")).toBeNull(); // missing document number
  });
});

/** Builds a scanner whose barcode hits are given as a sparse map of 1-indexed page -> decoded text. */
function fakeScanner(numPages: number, hits: Record<number, string>): BarcodeScanner {
  return {
    numPages,
    async scanPageForBarcode(pageNumber) {
      return hits[pageNumber] ?? null;
    },
  };
}

describe("detectDocumentBoundaries", () => {
  it("finds every cover-sheet barcode across the bundle, in page order", async () => {
    const scanner = fakeScanner(12, {
      1: "VG-705-2026-117631",
      5: "VG-705-2026-117630",
      9: "VG-705-2026-117632",
    });

    const result = await detectDocumentBoundaries(scanner);

    expect(result.pagesScanned).toBe(12);
    expect(result.barcodesFound).toBe(3);
    expect(result.boundaries).toEqual([
      { pageStart: 1, documentNumber: "117631", rawBarcode: "VG-705-2026-117631" },
      { pageStart: 5, documentNumber: "117630", rawBarcode: "VG-705-2026-117630" },
      { pageStart: 9, documentNumber: "117632", rawBarcode: "VG-705-2026-117632" },
    ]);
  });

  it("ignores non-cover-sheet barcodes found on content pages (no false positives)", async () => {
    const scanner = fakeScanner(4, {
      1: "VG-705-2026-117631",
      3: "some-other-barcode-on-a-content-page",
    });

    const result = await detectDocumentBoundaries(scanner);

    expect(result.barcodesFound).toBe(1);
    expect(result.boundaries).toEqual([{ pageStart: 1, documentNumber: "117631", rawBarcode: "VG-705-2026-117631" }]);
  });

  it("returns no boundaries when the bundle contains no cover-sheet barcodes", async () => {
    const scanner = fakeScanner(5, {});
    const result = await detectDocumentBoundaries(scanner);
    expect(result.boundaries).toEqual([]);
    expect(result.barcodesFound).toBe(0);
  });
});

describe("boundariesToNoticeRanges", () => {
  it("turns consecutive boundaries into inclusive page ranges, matching the real 4-page Hidalgo notice structure", () => {
    const boundaries = [
      { pageStart: 1, documentNumber: "117631", rawBarcode: "VG-705-2026-117631" },
      { pageStart: 5, documentNumber: "117630", rawBarcode: "VG-705-2026-117630" },
      { pageStart: 9, documentNumber: "117632", rawBarcode: "VG-705-2026-117632" },
    ];

    const ranges = boundariesToNoticeRanges(boundaries, 12);

    expect(ranges).toEqual([
      { documentNumber: "117631", pageStart: 1, pageEnd: 4 },
      { documentNumber: "117630", pageStart: 5, pageEnd: 8 },
      { documentNumber: "117632", pageStart: 9, pageEnd: 12 },
    ]);
  });

  it("runs the last notice through to the end of the bundle", () => {
    const boundaries = [{ pageStart: 3, documentNumber: "999999", rawBarcode: "VG-705-2026-999999" }];
    const ranges = boundariesToNoticeRanges(boundaries, 7);
    expect(ranges).toEqual([{ documentNumber: "999999", pageStart: 3, pageEnd: 7 }]);
  });

  it("produces a single-page notice when two cover sheets are back-to-back", () => {
    const boundaries = [
      { pageStart: 1, documentNumber: "111", rawBarcode: "VG-705-2026-111" },
      { pageStart: 2, documentNumber: "222", rawBarcode: "VG-705-2026-222" },
    ];
    const ranges = boundariesToNoticeRanges(boundaries, 2);
    expect(ranges).toEqual([
      { documentNumber: "111", pageStart: 1, pageEnd: 1 },
      { documentNumber: "222", pageStart: 2, pageEnd: 2 },
    ]);
  });

  it("returns an empty list for an empty boundary list", () => {
    expect(boundariesToNoticeRanges([], 10)).toEqual([]);
  });
});
