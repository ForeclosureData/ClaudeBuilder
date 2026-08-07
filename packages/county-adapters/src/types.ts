/**
 * Every county plugs into the worker through this interface. No county-
 * specific scraping/parsing logic may live outside a directory implementing
 * this interface — the worker and the rest of the app are county-agnostic.
 */
export interface DiscoveredNotice {
  /** Stable identifier for dedup within a single discovery run (e.g. the county's own filing/case number, or a URL). */
  externalId: string;
  countySourceKey: string;
  sourceUrl: string;
  documentUrl: string;
  filename: string;
  countyFilingNumber?: string;
  filingDate?: Date;
  documentTypeHint?: string;
}

export interface DownloadedNotice {
  notice: DiscoveredNotice;
  /** Raw file bytes. The worker hashes this and hands it to storage — the adapter never touches storage or hashing itself. */
  fileBuffer: Buffer;
  contentType: string;
}

export interface CountyForeclosureAdapter {
  countyName: string;
  state: string;
  /** Stable key used in CountySource.adapterKey and the adapter registry. */
  adapterKey: string;

  discoverNotices(params: { startDate?: Date; endDate?: Date }): Promise<DiscoveredNotice[]>;

  downloadNotice(notice: DiscoveredNotice): Promise<DownloadedNotice>;

  /** Optional: cheap metadata an adapter can read without a full extraction pass (e.g. a posting-index page's own columns). */
  parseMetadata?(notice: DiscoveredNotice): Promise<Record<string, unknown>>;

  /**
   * Optional: for adapters whose downloadNotice() returns a bundle
   * containing multiple individual notices (e.g. a county's monthly
   * consolidated PDF), split it into one entry per notice. When a county
   * adapter omits this, the downloaded document IS a single notice.
   * Bundle-splitting logic belongs entirely inside the county's own adapter
   * directory — the worker/ingestion pipeline only knows "call this if it
   * exists, then treat each result as its own notice."
   */
  splitBundle?(downloaded: DownloadedNotice, options?: SplitBundleOptions): Promise<BundledNotice[]>;
}

export interface SplitBundleOptions {
  /** Stop after producing this many notices — a hard cap for bounded/supervised test runs. Unbounded when omitted. */
  maxNotices?: number;
  /** Called after each unit of AI spend (in cents), if the adapter's splitting uses AI — lets the caller track/cap real cost as it runs. */
  onCost?: (costCents: number) => void;
  /**
   * Local OCR function for adapters that support it (currently Hidalgo
   * only — see hidalgo/ocr.ts). When provided, becomes the primary
   * content-extraction path instead of Claude vision; adapters without
   * local OCR ignore this. Deliberately generic rather than
   * Hidalgo-specific so any other scanned-PDF county adapter can reuse it.
   */
  ocr?: (pngBuffers: Buffer[]) => Promise<{ text: string; confidence: number }>;
  /** OCR confidence (0-100) below which the adapter should fall back to Claude vision, for adapters that support `ocr`. Ignored otherwise. */
  ocrConfidenceThreshold?: number;
  /** Render scale used for barcode/boundary scanning, for adapters that support barcode-based splitting. Ignored otherwise. */
  barcodeScanScale?: number;
}

export interface BundledNotice {
  /** Stable identifier for dedup, unique within the bundle (and, combined with the parent's externalId, globally unique). */
  externalId: string;
  countyFilingNumber: string | null;
  filingDate: Date | null;
  documentTypeHint: string | null;
  /** Plain-text content of this individual notice, ready for the extraction pipeline. */
  noticeText: string;
  /** A standalone PDF containing just this notice's pages, if the adapter can produce one — used for storage/provenance links. */
  fileBuffer: Buffer | null;
  contentType: string;
  /** True when the adapter itself flagged this split as low-confidence (e.g. thin/garbled transcription) — callers should weight this into manual-review decisions. */
  lowConfidence: boolean;
  /** Which path produced noticeText, for adapters that support local OCR. Omitted by adapters that don't. */
  contentSource?: "ocr" | "claude_vision" | "none";
  /** OCR confidence (0-100), only set when contentSource is "ocr" or the OCR attempt that triggered a Claude fallback. */
  ocrConfidence?: number | null;
}
