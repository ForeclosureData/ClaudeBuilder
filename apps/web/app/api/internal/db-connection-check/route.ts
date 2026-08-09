import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

/**
 * ONE-OFF diagnostic (read-only, no writes): reports which Postgres host
 * Next.js's own Prisma Client (Netlify's runtime env vars) is actually
 * connected to, and cross-checks a specific known value against what the
 * GitHub Actions-connected database showed, to resolve whether the two
 * environments are pointed at the same database or two different ones --
 * see docs/DEPLOYMENT.md's Netlify-DB-vs-Supabase discrepancy this was
 * built to investigate. Deleted/retired after use, same pattern as this
 * directory's other temporary routes. Never prints credentials.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  function hostPort(raw: string | undefined): { hostname: string; port: string; pathname: string } | null {
    if (!raw) return null;
    try {
      const u = new URL(raw);
      return { hostname: u.hostname, port: u.port || "(default)", pathname: u.pathname };
    } catch {
      return { hostname: "(unparseable)", port: "(unparseable)", pathname: "(unparseable)" };
    }
  }

  const databaseUrlInfo = hostPort(process.env.DATABASE_URL);
  const directUrlInfo = hostPort(process.env.DIRECT_URL);
  const sameHostPort = databaseUrlInfo && directUrlInfo && databaseUrlInfo.hostname === directUrlInfo.hostname && databaseUrlInfo.port === directUrlInfo.port;

  const foreclosureCaseCount = await prisma.foreclosureCase.count();
  const hid117914 = await prisma.foreclosureCase.findFirst({
    where: { countyFilingNumber: "117914" },
    include: { borrower: true },
  });
  const hid117888 = await prisma.foreclosureCase.findFirst({
    where: { countyFilingNumber: "117888" },
    include: { borrower: true },
  });

  let possibleDuplicateTableExists = false;
  let possibleDuplicateTableError: string | null = null;
  try {
    await prisma.$queryRawUnsafe(`SELECT 1 FROM public.possible_duplicate_notice_links LIMIT 1`);
    possibleDuplicateTableExists = true;
  } catch (err) {
    possibleDuplicateTableError = err instanceof Error ? err.message.slice(0, 300) : String(err);
  }

  const uniqueIndexRows = await prisma.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'foreclosure_cases' AND indexdef ILIKE '%county_filing_number%'`,
  );

  return NextResponse.json({
    databaseUrlHostPort: databaseUrlInfo,
    directUrlHostPort: directUrlInfo,
    databaseUrlEqualsDirectUrlHostPort: sameHostPort,
    foreclosureCaseCount,
    hid117914BorrowerFullName: hid117914?.borrower?.fullName ?? null,
    hid117914CaseId: hid117914?.id ?? null,
    hid117888BorrowerFullName: hid117888?.borrower?.fullName ?? null,
    hid117888CaseId: hid117888?.id ?? null,
    possibleDuplicateTableExists,
    possibleDuplicateTableError,
    countyFilingNumberUniqueIndexes: uniqueIndexRows,
  });
}
