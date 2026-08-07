import { promises as dns } from "node:dns";
import { NextResponse } from "next/server";

export const maxDuration = 60;

/**
 * TEMPORARY, re-activated for a second round of CAD reachability testing
 * against the CURRENT official portal (propaccess/esearch don't resolve —
 * see prior test). Same constraints as before: minimal requests, normal
 * UA, log status/headers only, no bypass attempts, no search submission,
 * no personal data collection. Re-neutered to a 410 stub immediately
 * after this run.
 */

const USER_AGENT = "ForeclosureDataBot/1.0 (+https://foreclosuredata-app.netlify.app; one-time access diagnostic)";
const TIMEOUT_MS = 10_000;

const TARGETS = [
  { host: "www.hidalgoad.org", searchPageUrl: "https://www.hidalgoad.org/property-search" },
  { host: "hidalgo.prodigycad.com", searchPageUrl: "https://hidalgo.prodigycad.com/property-search" },
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
  robotsTxt: HttpCheckResult & { disallowsRelevantPaths?: boolean };
  searchPage: HttpCheckResult;
}

export async function GET() {
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

  return {
    host,
    dns: dnsResult,
    httpRoot,
    httpsRoot,
    robotsTxt: {
      ...robotsTxt,
      disallowsRelevantPaths: robotsTxt.body ? /disallow:\s*\/(propert|search|parcel)/i.test(robotsTxt.body) : undefined,
    },
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

async function checkUrl(url: string, opts: { redirect: RequestRedirect; captureBody?: boolean }): Promise<HttpCheckResult> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: opts.redirect, signal: AbortSignal.timeout(TIMEOUT_MS) });
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
      body = text.slice(0, 500);
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
