/**
 * Deterministic, non-AI document-boundary detection for Hidalgo's bundled
 * foreclosure PDF.
 *
 * Every recorded document in the bundle is preceded by the county clerk's
 * recording cover sheet, which carries a CODE-39 barcode reading
 * "VG-<book>-<year>-<docNumber>" (e.g. "VG-705-2026-117631", decoded from a
 * real August 2026 posting -- Doc-117631, a 4-page "Notice of Substitute
 * Trustee Sale", immediately followed by Doc-117630 at page 5 and
 * Doc-117632 at page 9). Scanning every rendered page for this barcode and
 * treating each hit as the start of a new document reproduces the same
 * boundaries a human would read from the "Doc-XXXXXX" stamp, at zero
 * marginal cost since it runs entirely on local CPU (no AI calls).
 *
 * The scan itself (rendering + zbar) lives in pdfRender.ts; this module is
 * the pure, unit-testable boundary/range logic on top of it.
 */

const COVER_SHEET_BARCODE_PATTERN = /^VG-\d+-\d{4}-(\d+)$/;

export interface BarcodeScanner {
  numPages: number;
  /** Returns the decoded cover-sheet barcode text for a 1-indexed page, or null if none was found on that page. */
  scanPageForBarcode(pageNumber: number): Promise<string | null>;
}

export interface DocumentBoundary {
  pageStart: number;
  documentNumber: string;
  rawBarcode: string;
}

export interface DetectBoundariesResult {
  boundaries: DocumentBoundary[];
  pagesScanned: number;
  barcodesFound: number;
}

export interface NoticeRange {
  documentNumber: string;
  pageStart: number;
  pageEnd: number;
}

/** Parses a decoded barcode string against the Hidalgo cover-sheet format, returning the recording document number or null if the text doesn't match (e.g. a barcode from something other than a cover sheet). */
export function parseCoverSheetBarcode(text: string): { documentNumber: string } | null {
  const match = COVER_SHEET_BARCODE_PATTERN.exec(text.trim());
  if (!match || !match[1]) return null;
  return { documentNumber: match[1] };
}

/** Scans every page in the document via the provided scanner and returns the ordered list of cover-sheet boundaries found. */
export async function detectDocumentBoundaries(scanner: BarcodeScanner): Promise<DetectBoundariesResult> {
  const boundaries: DocumentBoundary[] = [];
  for (let page = 1; page <= scanner.numPages; page++) {
    const raw = await scanner.scanPageForBarcode(page);
    if (!raw) continue;
    const parsed = parseCoverSheetBarcode(raw);
    if (!parsed) continue;
    boundaries.push({ pageStart: page, documentNumber: parsed.documentNumber, rawBarcode: raw });
  }
  return { boundaries, pagesScanned: scanner.numPages, barcodesFound: boundaries.length };
}

/** Converts a flat list of cover-sheet hits into inclusive page ranges -- each notice runs from its cover sheet up to (but not including) the next one, or the end of the bundle for the last notice. */
export function boundariesToNoticeRanges(boundaries: DocumentBoundary[], totalPages: number): NoticeRange[] {
  return boundaries.map((boundary, index) => {
    const nextStart = boundaries[index + 1]?.pageStart ?? totalPages + 1;
    return { documentNumber: boundary.documentNumber, pageStart: boundary.pageStart, pageEnd: nextStart - 1 };
  });
}
