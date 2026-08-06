import { prisma, Prisma } from "@foreclosuredata/database";
import type { PropertyFilter } from "@foreclosuredata/validation";

export interface ForeclosureListFilters extends Partial<PropertyFilter> {
  profileId?: string | null;
}

/** Builds the shared Prisma where-clause for the property list, CSV export, and (later) alert matching — one implementation, not duplicated per caller. */
export function buildForeclosureCaseWhere(filters: ForeclosureListFilters): Prisma.ForeclosureCaseWhereInput {
  const where: Prisma.ForeclosureCaseWhereInput = {};
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

  return where;
}

export function foreclosureCaseListInclude() {
  return {
    county: true,
    property: true,
    sales: { orderBy: { saleDate: "asc" as const }, take: 1 },
    loan: { include: { currentMortgagee: true, originalLender: true } },
    borrower: true,
    currentOwner: true,
  } satisfies Prisma.ForeclosureCaseInclude;
}
