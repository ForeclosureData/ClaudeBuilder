import { prisma, Prisma } from "@foreclosuredata/database";
import type { PropertyFilter } from "@foreclosuredata/validation";
import { PUBLICATION_EXTRA_INCLUDE, filterPublic } from "@/lib/publicationVisibility";

export interface ForeclosureListFilters extends Partial<PropertyFilter> {
  profileId?: string | null;
}

/**
 * Builds the shared Prisma where-clause for the property list, CSV export,
 * and (later) alert matching — one implementation, not duplicated per
 * caller. Always excludes archived cases: every prior caller of this
 * function queried without an archivedAt filter at all, meaning archived
 * (superseded-duplicate) rows were visible on the public site. This is not
 * optional/filter-driven — a public surface must never show an archived
 * case, so it's baked in here rather than left for each caller to remember.
 */
export function buildForeclosureCaseWhere(filters: ForeclosureListFilters): Prisma.ForeclosureCaseWhereInput {
  const where: Prisma.ForeclosureCaseWhereInput = { archivedAt: null };
  const propertyWhere: Prisma.PropertyWhereInput = {};

  if (filters.countySlug) {
    where.county = { slug: filters.countySlug };
  }
  if (filters.city) {
    propertyWhere.city = { contains: filters.city, mode: "insensitive" };
  }
  if (filters.zipCode) {
    propertyWhere.zipCode = filters.zipCode;
  }
  if (filters.propertyType) {
    propertyWhere.propertyType = filters.propertyType as Prisma.EnumPropertyTypeFilter["equals"];
  }
  if (filters.classification) {
    propertyWhere.classification = filters.classification as Prisma.EnumPropertyClassificationFilter["equals"];
  }
  if (filters.minAddressConfidence !== undefined) {
    propertyWhere.addressResolutionConfidence = { gte: filters.minAddressConfidence };
  }
  if (filters.appraisedValueMinCents !== undefined || filters.appraisedValueMaxCents !== undefined) {
    propertyWhere.appraisedValueCents = {
      ...(filters.appraisedValueMinCents !== undefined ? { gte: filters.appraisedValueMinCents } : {}),
      ...(filters.appraisedValueMaxCents !== undefined ? { lte: filters.appraisedValueMaxCents } : {}),
    };
  }
  if (Object.keys(propertyWhere).length > 0) {
    where.property = propertyWhere;
  }

  if (filters.savedOnly && filters.profileId) {
    where.property = { ...(where.property as object), savedBy: { some: { profileId: filters.profileId } } };
  }

  if (filters.saleDateFrom || filters.saleDateTo) {
    where.sales = {
      some: {
        saleDate: {
          ...(filters.saleDateFrom ? { gte: new Date(filters.saleDateFrom) } : {}),
          ...(filters.saleDateTo ? { lte: new Date(filters.saleDateTo) } : {}),
        },
      },
    };
  }

  if (filters.borrowerSearch) {
    where.OR = [
      { borrower: { fullName: { contains: filters.borrowerSearch, mode: "insensitive" } } },
      { currentOwner: { fullName: { contains: filters.borrowerSearch, mode: "insensitive" } } },
    ];
  }
  if (filters.ownerSearch) {
    where.currentOwner = { fullName: { contains: filters.ownerSearch, mode: "insensitive" } };
  }
  if (filters.lenderSearch) {
    where.loan = {
      OR: [
        { currentMortgagee: { name: { contains: filters.lenderSearch, mode: "insensitive" } } },
        { originalLender: { name: { contains: filters.lenderSearch, mode: "insensitive" } } },
      ],
    };
  }
  if (filters.principalMinCents !== undefined || filters.principalMaxCents !== undefined) {
    where.loan = {
      ...(where.loan as object),
      originalPrincipalAmountCents: {
        ...(filters.principalMinCents !== undefined ? { gte: filters.principalMinCents } : {}),
        ...(filters.principalMaxCents !== undefined ? { lte: filters.principalMaxCents } : {}),
      },
    };
  }
  if (filters.manualReviewStatus) {
    where.documents = { some: { manualReviewStatus: filters.manualReviewStatus as Prisma.EnumManualReviewStatusFilter["equals"] } };
  }
  if (filters.subdivisionSearch) {
    propertyWhere.subdivision = { contains: filters.subdivisionSearch, mode: "insensitive" };
    where.property = propertyWhere;
  }
  if (filters.hasCountyValue) {
    propertyWhere.appraisedValueCents = { ...(propertyWhere.appraisedValueCents as object), not: null };
    where.property = propertyWhere;
  }
  if (filters.hasStreetAddress) {
    propertyWhere.propertyStreetAddress = { not: null };
    where.property = propertyWhere;
  }
  if (filters.newlyAddedWithinDays !== undefined) {
    where.createdAt = { gte: new Date(Date.now() - filters.newlyAddedWithinDays * 24 * 60 * 60 * 1000) };
  }

  return where;
}

export function foreclosureCaseListInclude() {
  return {
    county: true,
    property: true,
    sales: { orderBy: { saleDate: "asc" as const } },
    loan: { include: { currentMortgagee: true, originalLender: true } },
    borrower: true,
    currentOwner: true,
    ...PUBLICATION_EXTRA_INCLUDE,
  } satisfies Prisma.ForeclosureCaseInclude;
}

/**
 * The single fetch every public-facing route (property list, county page,
 * public API, CSV export) should use instead of calling
 * prisma.foreclosureCase.findMany directly. Applies buildForeclosureCaseWhere
 * (which always excludes archived cases) and then filterPublic() (which
 * excludes PENDING_REVIEW/WITHHELD cases) before paginating, so no caller
 * can accidentally leak a conflicted or archived case just by forgetting a
 * where-clause.
 *
 * Filters/paginates in application code rather than at the database level
 * because publication status depends on relational state (open review-task
 * reasons, duplicate links) that isn't cheaply expressible as a single SQL
 * predicate. Acceptable at the current bundle scale (low hundreds of rows);
 * if this ever needs true DB-level pagination, cache the computed status on
 * ForeclosureCase and recompute it on every write that could change it.
 */
export async function getPublicForeclosureCases(filters: ForeclosureListFilters, pagination?: { skip?: number; take?: number }) {
  const where = buildForeclosureCaseWhere(filters);
  const all = await prisma.foreclosureCase.findMany({ where, include: foreclosureCaseListInclude(), orderBy: { sales: { _count: "desc" } } });
  const visible = filterPublic(all);
  const totalCount = visible.length;
  const skip = pagination?.skip ?? 0;
  const take = pagination?.take;
  const cases = take !== undefined ? visible.slice(skip, skip + take) : visible.slice(skip);
  return { cases, totalCount };
}
