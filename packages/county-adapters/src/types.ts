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
}
