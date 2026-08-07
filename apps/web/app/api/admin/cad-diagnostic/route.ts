import { promises as dns } from "node:dns";
import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { getCurrentProfileId } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * TEMPORARY diagnostic — per product instruction, this must be run once
 * from the deployed runtime and then removed (the route file deleted),
 * not left publicly reachable. Admin-session-gated in the meantime.
 *
 * Sends the smallest possible number of requests (DNS lookup + a handful
 * of GETs) against the two Hidalgo CAD hosts, with a normal application
 * user agent, and never submits a search or collects personal data. It
 * only observes and logs status codes / headers / a few restriction
 * indicators (CAPTCHA/login copy) in page bodies — it does not attempt to
 * bypass anything it finds.
 */

const USER_AGENT = "ForeclosureDataBot/1.0 (+https://foreclosuredata-app.netlify.app; one-time access diagnostic)";
const TIMEOUT_MS = 10_000;

const TARGETS = [
  { host: "propaccess.hidalgoad.org", searchPageUrl: "https://propaccess.hidalgoad.org/ClientDB/PropertySearch.aspx?cid=1" },
  { host: "esearch.hidalgoad.org", searchPageUrl: "https://esearch.hidalgoad.org/" },
] as const;

interface HttpCheckResult {
  ok: boolean;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
  bodyBytesSampled?: number;
  restrictionIndicators?: string[];
  body?: string;
}

interface HostDiagnostic {
  host: string;
  dns: { ok: boolean; addresses?: string[]; error?: string };
  httpRoot: HttpCheckResult;
  httpsRoot: HttpCheckResult;
  robotsTxt: HttpCheckResult & { disallowsRelevantPaths?: boolean; body?: string };
  termsLinkFoundInHomepage: string | null;
  searchPage: HttpCheckResult;
}

export async function GET() {
  const profileId = await getCurrentProfileId();
  if (!profileId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const profile = await prisma.profile.findUnique({ where: { id: profileId } });
  if (!profile || profile.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const results: HostDiagnostic[] = [];
  for (const target of TARGETS) {
    results.push(await diagnoseHost(target.host, target.searchPageUrl));
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), userAgent: USER_AGENT, results });
}

async function diagnoseHost(host: string, searchPageUrl: string): Promise<HostDiagnostic> {
  const dnsResult = await checkDns(host);
  const httpRoot = await checkUrl(`http://${host}/`, { redirect: "manual" });
  const httpsRoot = await checkUrl(`https://${host}/`, { redirect: "follow" });
  const robotsTxt = await checkUrl(`https://${host}/robots.txt`, { redirect: "follow", captureBody: true });

  const searchPage = await checkUrl(searchPageUrl, { redirect: "follow", captureBody: true });

  // Deliberately not fetching a separate terms/access-policy page — that
  // would be an extra guessed request per host, against the "send only a
  // very small number of requests" constraint. If robotsTxt or the search
  // page's own body links to one, restrictionIndicators surfaces it.
  const termsLinkFoundInHomepage: string | null = null;

  return {
    host,
    dns: dnsResult,
    httpRoot,
    httpsRoot,
    robotsTxt: {
      ...robotsTxt,
      disallowsRelevantPaths: robotsTxt.body ? /disallow:\s*\/(clientdb|propertysearch|search)/i.test(robotsTxt.body) : undefined,
    },
    termsLinkFoundInHomepage,
    searchPage,
  };
}

async function checkDns(host: string): Promise<HostDiagnostic["dns"]> {
  try {
    const result = await dns.lookup(host, { all: true });
    return { ok: true, addresses: result.map((r) => r.address) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkUrl(
  url: string,
  opts: { redirect: RequestRedirect; captureBody?: boolean },
): Promise<HttpCheckResult> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: opts.redirect,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });

    let bodyBytesSampled = 0;
    let restrictionIndicators: string[] | undefined;
    let body: string | undefined;
    if (opts.captureBody) {
      const text = await res.text();
      bodyBytesSampled = text.length;
      body = text.slice(0, 2000);
      restrictionIndicators = detectRestrictionIndicators(text);
    }

    return { ok: true, status: res.status, headers, bodyBytesSampled, restrictionIndicators, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function detectRestrictionIndicators(html: string): string[] {
  const indicators: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/recaptcha|hcaptcha|g-recaptcha/i, "captcha_widget_present"],
    [/please\s+log\s*in|sign\s*in\s+required|authentication\s+required/i, "login_required_copy"],
    [/access\s+denied|forbidden/i, "access_denied_copy"],
    [/terms\s+of\s+use|terms\s+of\s+service/i, "terms_of_use_link_present"],
    [/rate\s*limit/i, "rate_limit_copy"],
  ];
  for (const [re, label] of checks) {
    if (re.test(html)) indicators.push(label);
  }
  return indicators;
}
