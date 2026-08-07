/**
 * Discovery via Hidalgo County's official sitemap.xml. The county publishes
 * one CMS page per monthly consolidated foreclosure posting (slug ending in
 * "-PROPERTY-SALE"); that page embeds a link to the actual bundled PDF under
 * /DocumentCenter/View/{id}/{slug}. Both requests are plain unauthenticated
 * GETs against public county pages — no login, no CAPTCHA, robots.txt does
 * not disallow either path (verified during research).
 */

export interface HidalgoPropertySalePosting {
  /** The DocumentCenter numeric document ID — stable across polls, used as the bundle's externalId. */
  documentId: string;
  /** The CMS page that linked to the document (kept for provenance/sourceUrl). */
  pageUrl: string;
  documentUrl: string;
  filename: string;
  /** e.g. "AUGUST-4-2026-PROPERTY-SALE" */
  saleMonthLabel: string;
  postedDate: Date | null;
}

export const HIDALGO_USER_AGENT =
  "ForeclosureDataBot/1.0 (+https://foreclosuredata-app.netlify.app; compliant polling, one sitemap check per 6 hours)";

const SITEMAP_URL = "https://www.hidalgocounty.us/sitemap.xml";
const PROPERTY_SALE_PAGE_RE = /<loc>(https:\/\/www\.hidalgocounty\.us\/\d+\/[A-Za-z0-9-]*PROPERTY-SALE)<\/loc>/gi;
const DOC_CENTER_LINK_RE = /DocumentCenter\/View\/(\d+)\/([A-Za-z0-9-]*PROPERTY-SALE)/i;
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Fetches the sitemap and every PROPERTY-SALE page it currently lists (the
 * county has historically kept only the current/upcoming month posted, so
 * this is typically a single extra request beyond the sitemap itself).
 */
export async function discoverPropertySalePostings(fetchImpl: typeof fetch = fetch): Promise<HidalgoPropertySalePosting[]> {
  const sitemapRes = await fetchImpl(SITEMAP_URL, { headers: { "User-Agent": HIDALGO_USER_AGENT } });
  if (!sitemapRes.ok) {
    throw new Error(`Hidalgo sitemap.xml returned HTTP ${sitemapRes.status}`);
  }
  const sitemapXml = await sitemapRes.text();

  const pageUrls = Array.from(sitemapXml.matchAll(PROPERTY_SALE_PAGE_RE), (m) => m[1]!);
  const postings: HidalgoPropertySalePosting[] = [];

  for (const pageUrl of pageUrls) {
    const pageRes = await fetchImpl(pageUrl, { headers: { "User-Agent": HIDALGO_USER_AGENT } });
    if (!pageRes.ok) continue; // transient failure on one posting; the next 6h poll will retry
    const html = await pageRes.text();
    const docMatch = html.match(DOC_CENTER_LINK_RE);
    if (!docMatch) continue;

    const documentId = docMatch[1]!;
    const slug = docMatch[2]!;
    postings.push({
      documentId,
      pageUrl,
      documentUrl: `https://www.hidalgocounty.us/DocumentCenter/View/${documentId}/${slug}`,
      filename: `${slug}.pdf`,
      saleMonthLabel: slug,
      postedDate: parseSaleMonthDate(slug),
    });
  }

  return postings;
}

function parseSaleMonthDate(slug: string): Date | null {
  const m = slug.match(/^([A-Za-z]+)-(\d{1,2})-(\d{4})-PROPERTY-SALE$/i);
  if (!m) return null;
  const monthIndex = MONTH_NAMES.indexOf(m[1]!.toLowerCase());
  if (monthIndex === -1) return null;
  const date = new Date(Date.UTC(Number(m[3]), monthIndex, Number(m[2])));
  return Number.isNaN(date.getTime()) ? null : date;
}
