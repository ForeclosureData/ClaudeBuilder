import type { BundledNotice, CountyForeclosureAdapter, DiscoveredNotice, DownloadedNotice, SplitBundleOptions } from "../types";
import { discoverPropertySalePostings, HIDALGO_USER_AGENT } from "./sitemap";
import { splitHidalgoBundle } from "./splitBundle";
import { extractPageRangeAsPdf } from "./pdfSplit";

/**
 * Live Hidalgo County adapter.
 *
 * Discovery: polls the county's own sitemap.xml for CMS pages whose slug
 * ends in "-PROPERTY-SALE" and follows the DocumentCenter link each one
 * embeds — both plain unauthenticated GETs against public pages. No
 * scraping of hidalgo.tx.publicsearch.us or Kofile, per product decision.
 *
 * Download: fetches the bundled monthly PDF directly.
 *
 * Split: see splitBundle.ts — the bundle has no text layer, so boundaries
 * (the recorder's "Doc-XXXXXX" cover sheet, which also states the page
 * count) and each notice's content are both read via Claude vision.
 */
export const hidalgoAdapter: CountyForeclosureAdapter = {
  countyName: "Hidalgo",
  state: "TX",
  adapterKey: "hidalgo",

  async discoverNotices(params: { startDate?: Date; endDate?: Date }): Promise<DiscoveredNotice[]> {
    const postings = await discoverPropertySalePostings();
    return postings
      .filter((p) => {
        if (params.startDate && p.postedDate && p.postedDate < params.startDate) return false;
        if (params.endDate && p.postedDate && p.postedDate > params.endDate) return false;
        return true;
      })
      .map((p) => ({
        externalId: p.documentId,
        countySourceKey: "hidalgo",
        sourceUrl: p.pageUrl,
        documentUrl: p.documentUrl,
        filename: p.filename,
        countyFilingNumber: undefined,
        filingDate: p.postedDate ?? undefined,
        documentTypeHint: "PROPERTY_SALE_BUNDLE",
      }));
  },

  async downloadNotice(notice: DiscoveredNotice): Promise<DownloadedNotice> {
    const res = await fetch(notice.documentUrl, { headers: { "User-Agent": HIDALGO_USER_AGENT } });
    if (!res.ok) {
      throw new Error(`Failed to download Hidalgo bundle ${notice.externalId}: HTTP ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return {
      notice,
      fileBuffer: Buffer.from(arrayBuffer),
      contentType: res.headers.get("content-type") ?? "application/pdf",
    };
  },

  async splitBundle(downloaded: DownloadedNotice, options?: SplitBundleOptions): Promise<BundledNotice[]> {
    const result = await splitHidalgoBundle(downloaded.fileBuffer, {
      maxNotices: options?.maxNotices,
      onCost: options?.onCost,
    });

    const bundled: BundledNotice[] = [];
    for (const notice of result.notices) {
      let fileBuffer: Buffer | null = null;
      try {
        fileBuffer = await extractPageRangeAsPdf(downloaded.fileBuffer, notice.pageStart, notice.pageEnd);
      } catch {
        // Non-fatal — the notice's transcribed text and provenance (bundle
        // URL + page range) are still usable without a standalone PDF.
        fileBuffer = null;
      }

      bundled.push({
        externalId: notice.documentNumber
          ? `${downloaded.notice.externalId}::doc-${notice.documentNumber}`
          : `${downloaded.notice.externalId}::pages-${notice.pageStart}-${notice.pageEnd}`,
        countyFilingNumber: notice.documentNumber,
        filingDate: parseRecordedOn(notice.recordedOn),
        documentTypeHint: notice.documentType,
        noticeText: notice.noticeText,
        fileBuffer,
        contentType: "application/pdf",
        lowConfidence: notice.lowConfidence,
      });
    }

    if (bundled.length === 0 && result.stoppedEarly) {
      throw new Error(`splitHidalgoBundle produced zero notices: ${result.stopReason ?? "unknown reason"}`);
    }
    return bundled;
  },
};

function parseRecordedOn(recordedOn: string | null): Date | null {
  if (!recordedOn) return null;
  const parsed = new Date(recordedOn);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export { splitHidalgoBundle } from "./splitBundle";
export type { SplitBundleResult, SplitNotice } from "./splitBundle";
export { discoverPropertySalePostings } from "./sitemap";
export type { HidalgoPropertySalePosting } from "./sitemap";
