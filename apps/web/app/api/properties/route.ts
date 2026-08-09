import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { propertyFilterSchema } from "@foreclosuredata/validation";
import { resolveEntitlement } from "@foreclosuredata/auth/entitlement";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { getPublicForeclosureCases } from "@/lib/properties";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const ip = clientIpFrom(request);
  if (!checkRateLimit(`properties:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const rawFilters = Object.fromEntries(searchParams.entries());
  const parsed = propertyFilterSchema.partial().safeParse({
    ...rawFilters,
    page: rawFilters.page ? Number(rawFilters.page) : undefined,
    pageSize: rawFilters.pageSize ? Number(rawFilters.pageSize) : undefined,
    savedOnly: rawFilters.savedOnly === "true",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const filters = parsed.data;
  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 25, 100);

  const profileId = await getCurrentProfileId();
  const entitlement = await resolveEntitlement(profileId);
  const effectivePageSize = entitlement.plan === "FREE" ? Math.min(pageSize, 20) : pageSize;

  const { cases, totalCount } = await getPublicForeclosureCases({ ...filters, profileId }, { skip: (page - 1) * effectivePageSize, take: effectivePageSize });

  const savedPropertyIds = profileId
    ? new Set((await prisma.savedProperty.findMany({ where: { profileId }, select: { propertyId: true } })).map((s) => s.propertyId))
    : new Set<string>();

  const items = cases.map((fc) => ({
    id: fc.property?.id ?? fc.id,
    countySlug: fc.county.slug,
    propertyStreetAddress: fc.property?.propertyStreetAddress ?? null,
    city: fc.property?.city ?? null,
    zipCode: fc.property?.zipCode ?? null,
    propertyType: fc.property?.propertyType ?? "UNKNOWN",
    classification: fc.property?.classification ?? "UNKNOWN",
    saleDate: fc.sales[0]?.saleDate?.toISOString() ?? null,
    saleStatus: fc.status,
    appraisedValueCents: fc.property?.appraisedValueCents ?? null,
    addressResolutionConfidence: fc.property?.addressResolutionConfidence ?? null,
    extractionConfidence: null,
    isSaved: fc.property ? savedPropertyIds.has(fc.property.id) : false,
  }));

  return NextResponse.json({ items, page, pageSize: effectivePageSize, totalCount: entitlement.plan === "FREE" ? Math.min(totalCount, 20) : totalCount });
}
