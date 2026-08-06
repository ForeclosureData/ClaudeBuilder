import { prisma } from "@foreclosuredata/database";

export interface CountyStats {
  upcomingCount: number;
  averageAppraisedValueCents: number | null;
  residentialCount: number;
  commercialCount: number;
  averageDaysUntilSale: number | null;
  nextSaleDate: string | null;
  newestNoticeAt: string | null;
}

/** Public, cheap aggregate stats for a county's landing page — no per-record details, safe to show without an account. */
export async function getCountyStats(countyId: string): Promise<CountyStats> {
  const cases = await prisma.foreclosureCase.findMany({
    where: { countyId, status: { in: ["SCHEDULED", "POSTPONED"] } },
    include: { property: true, sales: { orderBy: { saleDate: "asc" }, take: 1 } },
  });

  const upcomingCount = cases.length;
  const appraised = cases.map((c) => c.property?.appraisedValueCents).filter((v): v is number => typeof v === "number");
  const averageAppraisedValueCents = appraised.length ? Math.round(appraised.reduce((a, b) => a + b, 0) / appraised.length) : null;
  const residentialCount = cases.filter((c) => c.property?.classification === "RESIDENTIAL").length;
  const commercialCount = cases.filter((c) => c.property?.classification === "COMMERCIAL").length;

  const saleDates = cases.map((c) => c.sales[0]?.saleDate).filter((d): d is Date => Boolean(d));
  const nextSaleDate = saleDates.length ? new Date(Math.min(...saleDates.map((d) => d.getTime()))).toISOString() : null;
  const daysDiffs = saleDates.map((d) => Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24))));
  const averageDaysUntilSale = daysDiffs.length ? Math.round(daysDiffs.reduce((a, b) => a + b, 0) / daysDiffs.length) : null;

  const newest = await prisma.sourceDocument.findFirst({ where: { countyId }, orderBy: { dateCollected: "desc" } });

  return {
    upcomingCount,
    averageAppraisedValueCents,
    residentialCount,
    commercialCount,
    averageDaysUntilSale,
    nextSaleDate,
    newestNoticeAt: newest?.dateCollected.toISOString() ?? null,
  };
}
