export type { CountyForeclosureAdapter, DiscoveredNotice, DownloadedNotice, BundledNotice } from "./types";
export { getCountyAdapter, listCountyAdapters } from "./registry";
export { hidalgoAdapter, splitHidalgoBundle, discoverPropertySalePostings } from "./hidalgo/adapter";
export type { SplitBundleResult, SplitNotice } from "./hidalgo/adapter";
export type { HidalgoPropertySalePosting } from "./hidalgo/adapter";
export { hidalgoFixtureAdapter } from "./hidalgo/fixtureAdapter";
// hidalgo/ocr.ts (tesseract.js) is deliberately NOT re-exported here.
// Every route this package's Netlify build reaches imports from this same
// barrel file, and whether webpack safely tree-shakes an unused named
// re-export isn't something worth betting the Lambda bundle on a second
// time. The GitHub Actions ingestion script imports ocr.ts directly by
// path instead (see apps/web/scripts/ci-ingest-hidalgo.ts) -- it runs on a
// full Ubuntu runner, never through this barrel or the Netlify bundle.
