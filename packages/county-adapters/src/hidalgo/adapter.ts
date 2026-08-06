import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CountyForeclosureAdapter, DiscoveredNotice, DownloadedNotice } from "../types";

/**
 * Hidalgo County adapter — FIXTURE-BASED MOCK.
 *
 * This intentionally does not make any network request to a real county
 * website. Per the product plan, live scraping only starts once:
 *   1. The real site's structure has been inspected,
 *   2. robots.txt / terms of use have been reviewed,
 *   3. rate limiting + caching are implemented in the worker, and
 *   4. the ingestion workflow has been proven safe against fixtures (this).
 *
 * `discoverNotices` returns a small set of fabricated demo notices so the
 * rest of the pipeline (hashing, dedup, extraction, resolution, summary)
 * can be built and tested end-to-end. Swap this file's body for a real
 * HTTP/Playwright-based implementation later — nothing else in the app
 * needs to change, because everything else only depends on
 * `CountyForeclosureAdapter`.
 */

const FIXTURES_DIR = join(__dirname, "fixtures");

const FIXTURE_FILES = ["notice-001.txt", "notice-002.txt", "notice-003-poor-quality.txt"] as const;

export const hidalgoAdapter: CountyForeclosureAdapter = {
  countyName: "Hidalgo",
  state: "TX",
  adapterKey: "hidalgo",

  async discoverNotices(_params: { startDate?: Date; endDate?: Date }): Promise<DiscoveredNotice[]> {
    return FIXTURE_FILES.map((filename, index) => ({
      externalId: `hidalgo-fixture-${index + 1}`,
      countySourceKey: "hidalgo",
      sourceUrl: "https://example-fixture.local/hidalgo-foreclosure-notices",
      documentUrl: `https://example-fixture.local/hidalgo-foreclosure-notices/${filename}`,
      filename,
      documentTypeHint: "NOTICE_OF_TRUSTEE_SALE",
    }));
  },

  async downloadNotice(notice: DiscoveredNotice): Promise<DownloadedNotice> {
    const filePath = join(FIXTURES_DIR, notice.filename);
    const fileBuffer = readFileSync(filePath);
    return {
      notice,
      fileBuffer,
      // Fixtures are plain text standing in for a PDF's already-extracted
      // text layer, so the pipeline can skip straight to normalization
      // without needing a PDF-parsing dependency in this mock.
      contentType: "text/plain",
    };
  },
};
