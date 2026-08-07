import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CountyForeclosureAdapter, DiscoveredNotice, DownloadedNotice } from "../types";

/**
 * Hidalgo County adapter — FIXTURE-BASED MOCK, used only in tests and local
 * dev. Makes no network request. See ./adapter.ts for the live adapter that
 * actually polls hidalgocounty.us.
 */

const FIXTURES_DIR = join(__dirname, "fixtures");

const FIXTURE_FILES = ["notice-001.txt", "notice-002.txt", "notice-003-poor-quality.txt"] as const;

export const hidalgoFixtureAdapter: CountyForeclosureAdapter = {
  countyName: "Hidalgo",
  state: "TX",
  adapterKey: "hidalgo-fixture",

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
