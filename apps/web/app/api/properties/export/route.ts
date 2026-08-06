import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { resolveEntitlement } from "@foreclosuredata/auth/entitlement";
import { hasFullAccessToCounty } from "@foreclosuredata/types";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { buildForeclosureCaseWhere, foreclosureCaseListInclude } from "@/lib/properties";
import { toCsv } from "@/lib/csv";

/** Exports every record matching the current filters that the caller's entitlement can see. */
export async function GET(request: Request) {
  const profileId = await getCurrentProfileId();
  if (!profileId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const entitlement = await resolveEntitlement(profileId);
  if (!entitlement.canExportCsv) {
    return NextResponse.json({ error: "CSV export requires the Texas Unlimited plan." }, { status: 403 });
  }

  const subscription = await prisma.subscription.findUnique({ where: { profileId } });
  if (subscription && subscription.csvExportsUsedThisMonth >= entitlement.monthlyCsvExportLimit) {
    return NextResponse.json({ error: `You've used all ${entitlement.monthlyCsvExportLimit} CSV exports this month.` }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const where = buildForeclosureCaseWhere({
    countySlug: searchParams.get("countySlug") ?? undefined,
    city: searchParams.get("city") ?? undefined,
    profileId,
  });

  const cases = await prisma.foreclosureCase.findMany({ where, include: foreclosureCaseListInclude(), take: 5000 });
  const rows = cases
    .filter((fc) => hasFullAccessToCounty(entitlement, fc.county.slug))
    .map((fc) => ({
      county: fc.county.name,
      address: fc.property?.propertyStreetAddress ?? "",
      city: fc.property?.city ?? "",
      zip: fc.property?.zipCode ?? "",
      saleDate: fc.sales[0]?.saleDate?.toISOString().slice(0, 10) ?? "",
      saleStatus: fc.status,
      propertyType: fc.property?.propertyType ?? "",
      borrower: fc.borrower?.fullName ?? "",
      lender: fc.loan?.currentMortgagee?.name ?? fc.loan?.originalLender?.name ?? "",
      originalPrincipal: fc.loan?.originalPrincipalAmountCents ? (fc.loan.originalPrincipalAmountCents / 100).toFixed(2) : "",
      appraisedValue: fc.property?.appraisedValueCents ? (fc.property.appraisedValueCents / 100).toFixed(2) : "",
      addressResolutionConfidence: fc.property?.addressResolutionConfidence ?? "",
    }));

  await prisma.exportJob.create({
    data: { profileId, filterParams: Object.fromEntries(searchParams.entries()), rowCount: rows.length, status: "COMPLETED", completedAt: new Date() },
  });
  if (subscription) {
    await prisma.subscription.update({ where: { profileId }, data: { csvExportsUsedThisMonth: { increment: 1 } } });
  }

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="foreclosuredata-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
