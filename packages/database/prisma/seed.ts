/**
 * Fictional demo data only. Nothing in this file represents a real person,
 * lender, address, or county record — it exists so the rest of the app can
 * be built and demoed before the Hidalgo County adapter goes live.
 *
 * Demo Profile rows use fixed UUIDs. In a real Supabase environment,
 * Profile rows are created automatically (by the `handle_new_user` trigger
 * in sql/rls.sql) when someone signs up — these seeded rows only make
 * sense in local/demo Postgres where there is no Supabase auth to match
 * against.
 */
import { PrismaClient, PlanKey, SubscriptionStatus, PartyEntityType, PropertyType, PropertyClassification, AddressResolutionMethod, FieldSourceType, SaleStatus, CancellationStatus, DocumentType, DocumentProcessingStatus, ManualReviewStatus, OrganizationType, ManualReviewReason, ManualReviewTaskStatus, Role, CountyAvailabilityStatus, SourceAccessMethod, ConnectorHealth } from "@prisma/client";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { realHidalgoCases, type RealHidalgoCase } from "./hidalgo-real-cases";

const prisma = new PrismaClient();

const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_ADMIN_ID = "00000000-0000-4000-8000-000000000002";

/**
 * Real Supabase Auth account for testing the app from a customer's
 * perspective. This id must match the id of a real user created in the
 * connected Supabase project's Authentication > Users screen — Supabase
 * and this app's Postgres (Netlify DB/Neon) are separate databases, so
 * there is no trigger that creates this row automatically; it has to be
 * seeded here with the matching UUID.
 */
const REAL_TEST_USER_ID = "81aa2215-5b4d-40f6-864a-b52e72a24817";
const REAL_TEST_USER_EMAIL = "support@foreclosuredata.net";

async function main() {
  console.log("Seeding fictional demo data...");

  // ── Plans ────────────────────────────────────────────────────────────
  await prisma.planConfig.upsert({
    where: { planKey: PlanKey.FREE },
    update: {},
    create: {
      planKey: PlanKey.FREE,
      name: "Free",
      priceCents: 0,
      monthlyCsvExportLimit: 0,
      maxSavedProperties: 0,
      canViewDocuments: false,
      canReceiveAlerts: false,
      canViewRecordHistory: false,
      description: "Browse any county's upcoming sale dates and cities. No property details.",
    },
  });
  await prisma.planConfig.upsert({
    where: { planKey: PlanKey.COUNTY },
    update: {},
    create: {
      planKey: PlanKey.COUNTY,
      name: "County Plan",
      priceCents: 700,
      monthlyCsvExportLimit: 0,
      maxSavedProperties: 100,
      canViewDocuments: true,
      canReceiveAlerts: true,
      canViewRecordHistory: true,
      description: "Unlimited viewing, AI summaries, original documents, and search for one county.",
    },
  });
  await prisma.planConfig.upsert({
    where: { planKey: PlanKey.UNLIMITED },
    update: {},
    create: {
      planKey: PlanKey.UNLIMITED,
      name: "Texas Unlimited",
      priceCents: 2700,
      monthlyCsvExportLimit: 25,
      maxSavedProperties: 1000,
      canViewDocuments: true,
      canReceiveAlerts: true,
      canViewRecordHistory: true,
      description: "Access every currently supported Texas county, including newly added Texas counties as they launch.",
    },
  });

  // ── Demo users ───────────────────────────────────────────────────────
  const demoUser = await prisma.profile.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: { id: DEMO_USER_ID, email: "investor@example.com", fullName: "Dana Investor", role: Role.USER },
  });
  const demoAdmin = await prisma.profile.upsert({
    where: { id: DEMO_ADMIN_ID },
    update: {},
    create: { id: DEMO_ADMIN_ID, email: "admin@example.com", fullName: "Ada Admin", role: Role.ADMIN },
  });
  const realTestUser = await prisma.profile.upsert({
    where: { id: REAL_TEST_USER_ID },
    update: { email: REAL_TEST_USER_EMAIL },
    create: { id: REAL_TEST_USER_ID, email: REAL_TEST_USER_EMAIL, fullName: "ForeclosureData Test Account", role: Role.USER },
  });
  await prisma.notificationPreference.upsert({
    where: { profileId: demoUser.id },
    update: {},
    create: { profileId: demoUser.id },
  });
  await prisma.notificationPreference.upsert({
    where: { profileId: realTestUser.id },
    update: {},
    create: { profileId: realTestUser.id },
  });

  // ── State-level config (Texas-specific rules live here, not hardcoded) ──
  await prisma.stateConfig.upsert({
    where: { stateCode: "TX" },
    update: {},
    create: {
      stateCode: "TX",
      name: "Texas",
      foreclosureProcedureNotes:
        "Non-judicial trustee sales under Tex. Prop. Code § 51.002. Sales are held the first Tuesday of the month (hence the product's working name during early development) between 10am-4pm at the county-designated location.",
      noticeTerminology: { sale: "foreclosure sale", trustee: "substitute trustee", deed: "deed of trust" },
      statutoryNoticeDays: 21,
    },
  });

  // ── Counties + sources ───────────────────────────────────────────────
  const hidalgo = await prisma.county.upsert({
    where: { slug: "hidalgo-tx" },
    update: {},
    create: {
      name: "Hidalgo",
      state: "TX",
      slug: "hidalgo-tx",
      isActive: true,
      availabilityStatus: CountyAvailabilityStatus.SUPPORTED,
      estimatedPopulation: 870781,
      fipsCode: "48215",
    },
  });

  // Phase 2 candidates (docs/COUNTY_ROADMAP.md) — varied source systems and
  // volume, including one smaller rural county — not yet supported, so the
  // public site must show them as "coming soon," never as available.
  const comingSoonCounties: Array<{ name: string; slug: string; fipsCode: string; population: number; status: CountyAvailabilityStatus }> = [
    { name: "Cameron", slug: "cameron-tx", fipsCode: "48061", population: 421017, status: CountyAvailabilityStatus.RESEARCHING },
    { name: "Bexar", slug: "bexar-tx", fipsCode: "48029", population: 2009324, status: CountyAvailabilityStatus.RESEARCHING },
    { name: "Dallas", slug: "dallas-tx", fipsCode: "48113", population: 2613539, status: CountyAvailabilityStatus.REQUESTED },
    { name: "Harris", slug: "harris-tx", fipsCode: "48201", population: 4780828, status: CountyAvailabilityStatus.REQUESTED },
    { name: "Travis", slug: "travis-tx", fipsCode: "48453", population: 1290188, status: CountyAvailabilityStatus.REQUESTED },
    { name: "Starr", slug: "starr-tx", fipsCode: "48427", population: 65900, status: CountyAvailabilityStatus.RESEARCHING },
  ];
  for (const c of comingSoonCounties) {
    await prisma.county.upsert({
      where: { slug: c.slug },
      update: {},
      create: { name: c.name, state: "TX", slug: c.slug, isActive: false, availabilityStatus: c.status, estimatedPopulation: c.population, fipsCode: c.fipsCode },
    });
  }

  await prisma.countySource.upsert({
    where: { id: "seed-hidalgo-source" },
    update: {},
    create: {
      id: "seed-hidalgo-source",
      countyId: hidalgo.id,
      name: "Hidalgo County Precinct Foreclosure Postings (fixture adapter)",
      baseUrl: "https://example-fixture.local/hidalgo-foreclosure-notices",
      adapterKey: "hidalgo",
      isEnabled: true,
      pollIntervalMinutes: 1440,
      sourceVendor: "Custom county precinct site (fixture)",
      accessMethod: SourceAccessMethod.DIRECT_HTTP_DOWNLOAD,
      directDownloadsAvailable: true,
      authenticationRequired: false,
      captchaPresent: false,
      documentsHaveEmbeddedText: true,
      ocrUsuallyRequired: false,
      connectorHealth: ConnectorHealth.HEALTHY,
      approxMonthlyNoticeVolume: 180,
      lastSuccessfulSyncAt: new Date(),
      noticesDiscoveredCount: 4,
      documentsDownloadedCount: 4,
      documentsProcessedCount: 4,
      addressResolvedCount: 3,
      manualReviewCount: 1,
    },
  });

  await prisma.countySource.upsert({
    where: { id: "seed-hidalgo-real-source" },
    update: {},
    create: {
      id: "seed-hidalgo-real-source",
      countyId: hidalgo.id,
      name: "Hidalgo County Clerk (recorded foreclosure notices)",
      baseUrl: "https://hidalgocounty.us/232/County-Clerk",
      adapterKey: "hidalgo",
      isEnabled: true,
      pollIntervalMinutes: 1440,
      sourceVendor: "Hidalgo County Clerk's Office",
      accessMethod: SourceAccessMethod.DIRECT_HTTP_DOWNLOAD,
      directDownloadsAvailable: true,
      authenticationRequired: false,
      captchaPresent: false,
      documentsHaveEmbeddedText: false,
      ocrUsuallyRequired: true,
      connectorHealth: ConnectorHealth.HEALTHY,
      approxMonthlyNoticeVolume: 180,
      lastSuccessfulSyncAt: new Date(),
      noticesDiscoveredCount: realHidalgoCases.length,
      documentsDownloadedCount: realHidalgoCases.length,
      documentsProcessedCount: realHidalgoCases.length,
      addressResolvedCount: realHidalgoCases.filter((c) => c.addressMethod !== "UNRESOLVED").length,
      manualReviewCount: realHidalgoCases.filter((c) => c.manualReview).length,
    },
  });

  await prisma.dataSource.upsert({
    where: { key: "hidalgo_county_clerk" },
    update: {},
    create: { key: "hidalgo_county_clerk", name: "Hidalgo County Clerk (fixture)", type: FieldSourceType.COUNTY_CLERK, isEnabled: true },
  });
  await prisma.dataSource.upsert({
    where: { key: "hidalgo_appraisal_district" },
    update: {},
    create: { key: "hidalgo_appraisal_district", name: "Hidalgo County Appraisal District (fixture)", type: FieldSourceType.APPRAISAL_DISTRICT, isEnabled: true },
  });
  await prisma.dataSource.upsert({
    where: { key: "demo_geocoder" },
    update: {},
    create: { key: "demo_geocoder", name: "Demo Geocoding Service (fixture)", type: FieldSourceType.GEOCODING_SERVICE, isEnabled: true },
  });

  await prisma.budgetLimit.upsert({
    where: { key: "AI_MONTHLY_BUDGET_CENTS" },
    update: {},
    create: { key: "AI_MONTHLY_BUDGET_CENTS", limitCents: 2000, alertThresholdPct: 80 },
  });
  await prisma.budgetLimit.upsert({
    where: { key: "OCR_MONTHLY_BUDGET_CENTS" },
    update: {},
    create: { key: "OCR_MONTHLY_BUDGET_CENTS", limitCents: 1000, alertThresholdPct: 80 },
  });

  // ── Plan-to-billing-provider price mappings ─────────────────────────
  // Only MOCK rows are seeded — real Stripe price IDs / Authorize.net ARB
  // plan refs get added once those accounts exist (see docs/BILLING.md).
  const planMappings: Array<{ internalPlanId: "county_monthly" | "county_annual" | "texas_monthly" | "texas_annual"; interval: "MONTHLY" | "ANNUAL"; priceCents: number }> = [
    { internalPlanId: "county_monthly", interval: "MONTHLY", priceCents: 700 },
    { internalPlanId: "county_annual", interval: "ANNUAL", priceCents: 7000 },
    { internalPlanId: "texas_monthly", interval: "MONTHLY", priceCents: 2700 },
    { internalPlanId: "texas_annual", interval: "ANNUAL", priceCents: 27000 },
  ];
  for (const m of planMappings) {
    await prisma.planMapping.upsert({
      where: { internalPlanId_billingProvider: { internalPlanId: m.internalPlanId, billingProvider: "MOCK" } },
      update: {},
      create: {
        internalPlanId: m.internalPlanId,
        billingProvider: "MOCK",
        externalRef: `mock_${m.internalPlanId}`,
        billingInterval: m.interval,
        priceCents: m.priceCents,
      },
    });
  }

  // ── Demo subscriptions (need hidalgo.id for the COUNTY-plan demo user) ─
  await prisma.subscription.upsert({
    where: { profileId: demoUser.id },
    update: {},
    create: {
      profileId: demoUser.id,
      plan: PlanKey.COUNTY,
      status: SubscriptionStatus.ACTIVE,
      billingProvider: "MOCK",
      internalPlanId: "county_monthly",
      billingInterval: "MONTHLY",
      externalCustomerId: "mock_cust_demo_user",
      externalSubscriptionId: "mock_sub_demo_user",
      selectedCountyId: hidalgo.id,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.subscription.upsert({
    where: { profileId: demoAdmin.id },
    update: {},
    create: {
      profileId: demoAdmin.id,
      plan: PlanKey.UNLIMITED,
      status: SubscriptionStatus.ACTIVE,
      billingProvider: "MOCK",
      internalPlanId: "texas_annual",
      billingInterval: "ANNUAL",
      externalCustomerId: "mock_cust_demo_admin",
      externalSubscriptionId: "mock_sub_demo_admin",
      isFoundingMember: true,
      foundingMemberApprovedAt: new Date(),
    },
  });
  // Real test account (Texas Unlimited tier — full access to every
  // feature so it's usable for testing from a customer's perspective,
  // not scoped to a single county).
  await prisma.subscription.upsert({
    where: { profileId: realTestUser.id },
    update: {},
    create: {
      profileId: realTestUser.id,
      plan: PlanKey.UNLIMITED,
      status: SubscriptionStatus.ACTIVE,
      billingProvider: "MOCK",
      internalPlanId: "texas_monthly",
      billingInterval: "MONTHLY",
      externalCustomerId: "mock_cust_real_test_user",
      externalSubscriptionId: "mock_sub_real_test_user",
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  // ── Hidalgo foreclosure cases: real, not fictional ──────────────────
  // These 82 cases come from real Hidalgo County-recorded foreclosure
  // notices (2026), manually transcribed from the source PDFs bundled at
  // apps/web/public/hidalgo-source-docs/. Every deploy wipes and rebuilds
  // this county's case tree from realHidalgoCases so the seed script is
  // idempotent (earlier revisions of this file re-created fictional demo
  // cases on every `db:seed` run, which is why production accumulated many
  // duplicates before this rewrite).
  await wipeHidalgoCases(hidalgo.id);
  for (const c of realHidalgoCases) {
    await seedRealCase(hidalgo.id, c);
  }

  console.log(`Seed complete. ${realHidalgoCases.length} real Hidalgo cases loaded.`);
}

interface SeedCaseInput {
  caseNumber: string;
  borrowerName: string;
  grantorName: string;
  ownerName: string;
  lenderName: string;
  servicerName: string;
  trusteeName: string;
  trusteeCompany: string;
  address: string | null;
  city: string;
  zip: string | null;
  subdivision: string;
  lot: string | null;
  block: string | null;
  acreage: number | null;
  propertyType: PropertyType;
  classification: PropertyClassification;
  appraisedValueCents: number | null;
  principalCents: number;
  loanDateISO: string;
  saleDateISO: string;
  saleTime: string;
  saleLocation: string;
  resolutionMethod: AddressResolutionMethod;
  resolutionConfidence: number;
  resolutionExplanation: string;
  extractionConfidence: number;
  manualReview: boolean;
  manualReviewReason?: ManualReviewReason;
  ownerOccupied: boolean | null;
  homestead: boolean | null;
  currentBalanceStatedCents: number | null;
  canceled?: boolean;
}

async function seedCase(countyId: string, input: SeedCaseInput) {
  const borrower = await prisma.person.create({ data: { fullName: input.borrowerName } });
  const grantor =
    input.grantorName === input.borrowerName
      ? borrower
      : await prisma.person.create({ data: { fullName: input.grantorName } });
  const owner =
    input.ownerName === input.borrowerName
      ? borrower
      : await prisma.person.create({ data: { fullName: input.ownerName } });

  const lender = await prisma.organization.create({
    data: { name: input.lenderName, type: OrganizationType.LENDER },
  });
  const servicer =
    input.servicerName === input.lenderName
      ? lender
      : await prisma.organization.create({ data: { name: input.servicerName, type: OrganizationType.SERVICER } });
  const trusteeCompanyOrg = await prisma.organization.create({
    data: { name: input.trusteeCompany, type: OrganizationType.TRUSTEE_COMPANY },
  });
  const trusteePerson = await prisma.person.create({ data: { fullName: input.trusteeName } });
  const trustee = await prisma.trustee.create({
    data: { personId: trusteePerson.id, organizationId: trusteeCompanyOrg.id },
  });

  let property = null;
  if (input.resolutionMethod !== AddressResolutionMethod.UNRESOLVED) {
    property = await prisma.property.create({
      data: {
        countyId,
        propertyStreetAddress: input.address,
        city: input.city,
        zipCode: input.zip,
        subdivision: input.subdivision,
        lot: input.lot,
        block: input.block,
        acreage: input.acreage,
        propertyType: input.propertyType,
        classification: input.classification,
        appraisedValueCents: input.appraisedValueCents,
        addressResolutionMethod: input.resolutionMethod,
        addressResolutionConfidence: input.resolutionConfidence,
        addressResolutionExplanation: input.resolutionExplanation,
      },
    });
  }

  const summary = buildSummary(input);

  const fc = await prisma.foreclosureCase.create({
    data: {
      countyId,
      propertyId: property?.id,
      caseNumber: input.caseNumber,
      status: input.canceled ? SaleStatus.CANCELED : SaleStatus.SCHEDULED,
      entityType: input.borrowerName.match(/LLC|Corp|Inc|Co\./) ? PartyEntityType.ENTITY : PartyEntityType.INDIVIDUAL,
      ownerOccupied: input.ownerOccupied,
      homestead: input.homestead,
      borrowerPersonId: borrower.id,
      grantorPersonId: grantor.id,
      currentOwnerPersonId: owner.id,
      summaryText: summary,
      summaryGeneratedAt: new Date(),
      lastVerifiedAt: new Date(),
    },
  });

  const doc = await prisma.sourceDocument.create({
    data: {
      countyId,
      countySourceId: "seed-hidalgo-source",
      foreclosureCaseId: fc.id,
      sourceUrl: "https://example-fixture.local/hidalgo-foreclosure-notices",
      documentUrl: `https://example-fixture.local/hidalgo-foreclosure-notices/${input.caseNumber}.pdf`,
      filename: `${input.caseNumber}.pdf`,
      countyFilingNumber: input.caseNumber,
      filingDate: new Date(input.loanDateISO),
      documentType: input.canceled ? DocumentType.CANCELLATION_NOTICE : DocumentType.NOTICE_OF_TRUSTEE_SALE,
      pageCount: 2,
      sha256Hash: `demo-${input.caseNumber}-${Math.random().toString(36).slice(2, 10)}`,
      extractionConfidence: input.extractionConfidence,
      manualReviewStatus: input.manualReview ? ManualReviewStatus.PENDING : ManualReviewStatus.NOT_NEEDED,
      status: DocumentProcessingStatus.SUMMARIZED,
      processingCostCents: 0,
    },
  });

  await prisma.foreclosureSale.create({
    data: {
      foreclosureCaseId: fc.id,
      sourceDocumentId: doc.id,
      saleDate: new Date(input.saleDateISO),
      saleTime: input.saleTime,
      saleLocation: input.saleLocation,
      noticePostingDate: new Date(input.loanDateISO),
      earliestSaleDate: new Date(input.saleDateISO),
      saleStatus: input.canceled ? SaleStatus.CANCELED : SaleStatus.SCHEDULED,
      cancellationStatus: input.canceled ? CancellationStatus.CANCELED : CancellationStatus.NOT_CANCELED,
      trusteeId: trustee.id,
    },
  });

  await prisma.loan.create({
    data: {
      foreclosureCaseId: fc.id,
      originalLenderOrgId: lender.id,
      currentMortgageeOrgId: lender.id,
      mortgageServicerOrgId: servicer.id,
      originalPrincipalAmountCents: input.principalCents,
      originalLoanDate: new Date(input.loanDateISO),
      deedOfTrustDate: new Date(input.loanDateISO),
      recordingDate: new Date(input.loanDateISO),
      currentPrincipalBalanceCents: input.currentBalanceStatedCents,
      ...(input.currentBalanceStatedCents === null
        ? {
            estimatedRemainingBalanceCents: estimateBalance(input.principalCents, input.loanDateISO),
            remainingBalanceMethodology: "amortized_estimate_v1",
            remainingBalanceConfidence: 0.4,
            remainingBalanceAssumptions: {
              assumedAnnualInterestRatePct: 6.5,
              assumedTermYears: 30,
              calculationDate: new Date().toISOString().slice(0, 10),
              note: "Estimate only. Does not subtract missed payments, fees, advances, taxes, or insurance.",
            },
          }
        : {}),
    },
  });

  if (property) {
    await prisma.propertyAddress.create({
      data: {
        foreclosureCaseId: fc.id,
        propertyId: property.id,
        rawAddressText: input.address ?? `${input.subdivision}, Lot ${input.lot ?? "?"}, Block ${input.block ?? "?"}`,
        method: input.resolutionMethod,
        confidence: input.resolutionConfidence,
        explanation: input.resolutionExplanation,
        isSelected: true,
      },
    });
  }

  await prisma.legalDescription.create({
    data: {
      foreclosureCaseId: fc.id,
      sourceDocumentId: doc.id,
      rawText: `Lot ${input.lot ?? "Unknown"}, Block ${input.block ?? "Unknown"}, ${input.subdivision}, Hidalgo County, Texas`,
      subdivision: input.subdivision,
      lot: input.lot,
      block: input.block,
      acreage: input.acreage,
    },
  });

  // Field-level provenance for the key fields shown on the detail page.
  const fields: Array<{ fieldName: string; value: string | null; sourceType: FieldSourceType; confidence: number; explicitlyStated: boolean; supportingText?: string }> = [
    { fieldName: "borrowerName", value: input.borrowerName, sourceType: FieldSourceType.FORECLOSURE_NOTICE, confidence: input.extractionConfidence, explicitlyStated: true, supportingText: `Grantor(s): ${input.borrowerName}` },
    { fieldName: "lenderName", value: input.lenderName, sourceType: FieldSourceType.FORECLOSURE_NOTICE, confidence: input.extractionConfidence, explicitlyStated: true, supportingText: `Current Mortgagee: ${input.lenderName}` },
    { fieldName: "saleDate", value: input.saleDateISO, sourceType: FieldSourceType.FORECLOSURE_NOTICE, confidence: 0.97, explicitlyStated: true, supportingText: `Date of Sale: ${input.saleDateISO}` },
    { fieldName: "originalPrincipalAmount", value: String(input.principalCents / 100), sourceType: FieldSourceType.FORECLOSURE_NOTICE, confidence: 0.9, explicitlyStated: true, supportingText: `original principal amount of $${(input.principalCents / 100).toLocaleString()}` },
  ];
  if (property && input.address) {
    fields.push({
      fieldName: "propertyStreetAddress",
      value: input.address,
      sourceType: input.resolutionMethod === AddressResolutionMethod.EXPLICIT_STATED ? FieldSourceType.FORECLOSURE_NOTICE : FieldSourceType.APPRAISAL_DISTRICT,
      confidence: input.resolutionConfidence,
      explicitlyStated: input.resolutionMethod === AddressResolutionMethod.EXPLICIT_STATED,
      supportingText: input.resolutionExplanation,
    });
  }
  if (input.currentBalanceStatedCents !== null) {
    fields.push({
      fieldName: "currentPrincipalBalance",
      value: String(input.currentBalanceStatedCents / 100),
      sourceType: FieldSourceType.FORECLOSURE_NOTICE,
      confidence: 0.88,
      explicitlyStated: true,
      supportingText: `unpaid balance of $${(input.currentBalanceStatedCents / 100).toLocaleString()}`,
    });
  }
  for (const f of fields) {
    await prisma.extractedField.create({
      data: {
        sourceDocumentId: doc.id,
        entityType: "ForeclosureCase",
        entityId: fc.id,
        fieldName: f.fieldName,
        value: f.value,
        sourceType: f.sourceType,
        confidence: f.confidence,
        explicitlyStated: f.explicitlyStated,
        supportingText: f.supportingText,
        pageNumber: 1,
        verifiedAt: new Date(),
      },
    });
  }

  if (input.manualReview) {
    await prisma.manualReviewTask.create({
      data: {
        sourceDocumentId: doc.id,
        foreclosureCaseId: fc.id,
        reason: input.manualReviewReason ?? ManualReviewReason.LOW_CONFIDENCE,
        status: ManualReviewTaskStatus.OPEN,
        notes: input.resolutionExplanation,
      },
    });
  }
}

function estimateBalance(principalCents: number, loanDateISO: string): number {
  const monthlyRate = 0.065 / 12;
  const totalMonths = 30 * 12;
  const monthsElapsed = Math.min(
    totalMonths,
    Math.max(0, Math.round((Date.now() - new Date(loanDateISO).getTime()) / (30.44 * 24 * 60 * 60 * 1000))),
  );
  const P = principalCents / 100;
  const remaining =
    (P * (Math.pow(1 + monthlyRate, totalMonths) - Math.pow(1 + monthlyRate, monthsElapsed))) /
    (Math.pow(1 + monthlyRate, totalMonths) - 1);
  return Math.round(remaining * 100);
}

function buildSummary(input: SeedCaseInput): string {
  const propertyKind = input.classification === PropertyClassification.COMMERCIAL ? "commercial" : input.classification === PropertyClassification.RESIDENTIAL ? "residential" : "property";
  const addressPart = input.address ? `located at ${input.address}, ${input.city}, TX` : `in the ${input.subdivision} area of ${input.city}, TX (exact address not yet confirmed)`;
  const balancePart =
    input.currentBalanceStatedCents !== null
      ? `The notice states an unpaid balance of $${(input.currentBalanceStatedCents / 100).toLocaleString()}.`
      : "The notice does not state the current payoff balance.";
  const resolutionPart =
    input.resolutionMethod === AddressResolutionMethod.UNRESOLVED
      ? "The property address could not be confidently resolved and this record is in manual review."
      : `The property address was matched using ${input.resolutionMethod.toLowerCase().replaceAll("_", " ")}.`;

  return `This ${propertyKind} ${addressPart} is scheduled for foreclosure sale on ${input.saleDateISO}. The notice identifies ${input.borrowerName} as the borrower and ${input.lenderName} as the mortgagee. The original deed of trust was recorded around ${input.loanDateISO} with an original principal amount of $${(input.principalCents / 100).toLocaleString()}. ${balancePart} ${resolutionPart}`;
}

/**
 * Deletes every existing Hidalgo case, document, and party record before
 * reseeding. Runs on every `db:seed` invocation (every deploy, per
 * netlify.toml) so seeding real cases is idempotent instead of
 * accumulating duplicates the way the old fictional-data seedCase() calls
 * did across dozens of prior deploys. Person/Organization/Trustee are
 * wiped unconditionally because nothing else in this seed file creates
 * them.
 */
async function wipeHidalgoCases(countyId: string) {
  await prisma.manualReviewTask.deleteMany({ where: { foreclosureCase: { countyId } } });
  await prisma.extractedField.deleteMany({ where: { sourceDocument: { countyId } } });
  await prisma.correctionReport.deleteMany({ where: { foreclosureCase: { countyId } } });
  await prisma.foreclosureCase.deleteMany({ where: { countyId } });
  await prisma.sourceDocument.deleteMany({ where: { countyId } });
  await prisma.property.deleteMany({ where: { countyId } });
  await prisma.trustee.deleteMany({});
  await prisma.person.deleteMany({});
  await prisma.organization.deleteMany({});
}

function hashSourceDocument(pdfFilename: string): string {
  try {
    const pdfPath = join(__dirname, "../../../apps/web/public/hidalgo-source-docs", pdfFilename);
    return createHash("sha256").update(readFileSync(pdfPath)).digest("hex");
  } catch {
    console.warn(`Could not read ${pdfFilename} to hash; falling back to filename-derived hash.`);
    return createHash("sha256").update(`hidalgo-source-docs/${pdfFilename}`).digest("hex");
  }
}

const REAL_ADDRESS_METHOD: Record<RealHidalgoCase["addressMethod"], AddressResolutionMethod> = {
  EXPLICIT_STATED: AddressResolutionMethod.EXPLICIT_STATED,
  COMMONLY_KNOWN_AS_PHRASE: AddressResolutionMethod.COMMONLY_KNOWN_AS_PHRASE,
  UNRESOLVED: AddressResolutionMethod.UNRESOLVED,
};

const REAL_CLASSIFICATION: Record<RealHidalgoCase["classification"], PropertyClassification> = {
  RESIDENTIAL: PropertyClassification.RESIDENTIAL,
  COMMERCIAL: PropertyClassification.COMMERCIAL,
  UNKNOWN: PropertyClassification.UNKNOWN,
};

async function seedRealCase(countyId: string, c: RealHidalgoCase) {
  const grantor = await prisma.person.create({ data: { fullName: c.grantorNames } });

  const currentOrg = await prisma.organization.create({
    data: { name: c.currentMortgagee, type: OrganizationType.LENDER },
  });
  const originalOrg =
    c.origMortgagee === null || c.origMortgagee === c.currentMortgagee
      ? currentOrg
      : await prisma.organization.create({ data: { name: c.origMortgagee, type: OrganizationType.LENDER } });
  const servicerOrg =
    c.servicerName === null || c.servicerName === c.currentMortgagee
      ? currentOrg
      : await prisma.organization.create({ data: { name: c.servicerName, type: OrganizationType.SERVICER } });

  const addressMethod = REAL_ADDRESS_METHOD[c.addressMethod];
  const resolutionConfidence = c.addressMethod === "EXPLICIT_STATED" ? 0.98 : c.addressMethod === "COMMONLY_KNOWN_AS_PHRASE" ? 0.9 : null;
  const resolutionExplanation =
    c.addressMethod === "EXPLICIT_STATED"
      ? "Street address was explicitly stated in the foreclosure notice."
      : c.addressMethod === "COMMONLY_KNOWN_AS_PHRASE"
        ? 'Street address was given in the notice under a "commonly known as" clause.'
        : "The notice gave only a legal description (subdivision/lot/block or metes-and-bounds), with no street address stated, and it was not cross-referenced against appraisal district records.";

  let property = null;
  if (addressMethod !== AddressResolutionMethod.UNRESOLVED) {
    property = await prisma.property.create({
      data: {
        countyId,
        propertyStreetAddress: c.address,
        city: c.city,
        zipCode: c.zip,
        subdivision: c.subdivision,
        lot: c.lot,
        block: c.block,
        propertyType: PropertyType.UNKNOWN,
        classification: REAL_CLASSIFICATION[c.classification],
        addressResolutionMethod: addressMethod,
        addressResolutionConfidence: resolutionConfidence,
        addressResolutionExplanation: resolutionExplanation,
      },
    });
  }

  const fc = await prisma.foreclosureCase.create({
    data: {
      countyId,
      propertyId: property?.id,
      caseNumber: `HID-${c.docNumber}`,
      status: SaleStatus.SCHEDULED,
      entityType: c.entityType === "ENTITY" ? PartyEntityType.ENTITY : PartyEntityType.INDIVIDUAL,
      borrowerPersonId: grantor.id,
      grantorPersonId: grantor.id,
      currentOwnerPersonId: grantor.id,
      summaryText: buildRealSummary(c),
      lastVerifiedAt: new Date(),
    },
  });

  const doc = await prisma.sourceDocument.create({
    data: {
      countyId,
      countySourceId: "seed-hidalgo-real-source",
      foreclosureCaseId: fc.id,
      sourceUrl: "https://hidalgocounty.us/232/County-Clerk",
      documentUrl: `/hidalgo-source-docs/${c.pdfFilename}`,
      filename: c.pdfFilename,
      countyFilingNumber: c.docNumber,
      filingDate: c.dotDateISO ? new Date(c.dotDateISO) : null,
      documentType: DocumentType.NOTICE_OF_TRUSTEE_SALE,
      dateCollected: new Date(),
      sha256Hash: hashSourceDocument(c.pdfFilename),
      extractionConfidence: c.manualReview ? 0.6 : 0.95,
      manualReviewStatus: c.manualReview ? ManualReviewStatus.PENDING : ManualReviewStatus.NOT_NEEDED,
      status: DocumentProcessingStatus.SUMMARIZED,
      ocrUsed: true,
      processingCostCents: 0,
    },
  });

  await prisma.foreclosureSale.create({
    data: {
      foreclosureCaseId: fc.id,
      sourceDocumentId: doc.id,
      saleDate: new Date(c.saleDateISO),
      saleTime: c.saleTime,
      saleLocation: c.saleLocation,
      earliestSaleDate: new Date(c.saleDateISO),
      saleStatus: SaleStatus.SCHEDULED,
      cancellationStatus: CancellationStatus.NOT_CANCELED,
    },
  });

  await prisma.loan.create({
    data: {
      foreclosureCaseId: fc.id,
      originalLenderOrgId: originalOrg.id,
      currentMortgageeOrgId: currentOrg.id,
      mortgageServicerOrgId: servicerOrg.id,
      originalPrincipalAmountCents: c.principalCents,
      deedOfTrustDate: c.dotDateISO ? new Date(c.dotDateISO) : null,
      instrumentNumber: c.instrumentNumber,
      recordingDate: c.dotDateISO ? new Date(c.dotDateISO) : null,
    },
  });

  if (property) {
    await prisma.propertyAddress.create({
      data: {
        foreclosureCaseId: fc.id,
        propertyId: property.id,
        rawAddressText: c.address ?? `${c.subdivision ?? "Unknown subdivision"}, Lot ${c.lot ?? "?"}${c.block ? `, Block ${c.block}` : ""}`,
        method: addressMethod,
        confidence: resolutionConfidence ?? 0,
        explanation: resolutionExplanation,
        isSelected: true,
      },
    });
  }

  await prisma.legalDescription.create({
    data: {
      foreclosureCaseId: fc.id,
      sourceDocumentId: doc.id,
      rawText: c.legalRawText ?? `Legal description not separately transcribed from this notice (see original document, Instrument No. ${c.instrumentNumber ?? "unknown"}, Hidalgo County real property records).`,
      subdivision: c.subdivision,
      lot: c.lot,
      block: c.block,
    },
  });

  const fields: Array<{ fieldName: string; value: string | null; sourceType: FieldSourceType; confidence: number; explicitlyStated: boolean; supportingText?: string }> = [
    { fieldName: "borrowerName", value: c.grantorNames, sourceType: FieldSourceType.FORECLOSURE_NOTICE, confidence: 0.97, explicitlyStated: true, supportingText: `Grantor(s)/Mortgagor(s): ${c.grantorNames}` },
    { fieldName: "lenderName", value: c.currentMortgagee, sourceType: FieldSourceType.FORECLOSURE_NOTICE, confidence: 0.97, explicitlyStated: true, supportingText: `Current Mortgagee/Beneficiary: ${c.currentMortgagee}` },
    { fieldName: "saleDate", value: c.saleDateISO, sourceType: FieldSourceType.FORECLOSURE_NOTICE, confidence: 0.98, explicitlyStated: true, supportingText: `Date of Sale: ${c.saleDateISO}` },
  ];
  if (c.principalCents !== null) {
    fields.push({
      fieldName: "originalPrincipalAmount",
      value: String(c.principalCents / 100),
      sourceType: FieldSourceType.FORECLOSURE_NOTICE,
      confidence: 0.95,
      explicitlyStated: true,
      supportingText: `Original principal amount of $${(c.principalCents / 100).toLocaleString()}`,
    });
  }
  if (property && c.address) {
    fields.push({
      fieldName: "propertyStreetAddress",
      value: c.address,
      sourceType: FieldSourceType.FORECLOSURE_NOTICE,
      confidence: resolutionConfidence ?? 0.9,
      explicitlyStated: true,
      supportingText: resolutionExplanation,
    });
  }
  for (const f of fields) {
    await prisma.extractedField.create({
      data: {
        sourceDocumentId: doc.id,
        entityType: "ForeclosureCase",
        entityId: fc.id,
        fieldName: f.fieldName,
        value: f.value,
        sourceType: f.sourceType,
        confidence: f.confidence,
        explicitlyStated: f.explicitlyStated,
        supportingText: f.supportingText,
        pageNumber: 1,
        verifiedAt: new Date(),
      },
    });
  }

  if (c.manualReview) {
    await prisma.manualReviewTask.create({
      data: {
        sourceDocumentId: doc.id,
        foreclosureCaseId: fc.id,
        reason: ManualReviewReason.POOR_TEXT_QUALITY,
        status: ManualReviewTaskStatus.OPEN,
        notes: c.dataQualityNote ?? "Flagged during manual transcription for review.",
      },
    });
  }
}

function buildRealSummary(c: RealHidalgoCase): string {
  const addressPart = c.address
    ? `located at ${c.address}${c.city ? `, ${c.city}, TX` : ", TX"}`
    : c.subdivision
      ? `in the ${c.subdivision}${c.city ? ` area of ${c.city}, TX` : " area"} (no street address stated in the notice)`
      : "with no street address or subdivision stated in the notice";
  const principalPart =
    c.principalCents !== null
      ? `The notice states an original principal amount of $${(c.principalCents / 100).toLocaleString()}.`
      : "The notice does not state an original principal amount.";
  const dotPart = c.dotDateISO ? `The Deed of Trust is dated ${c.dotDateISO}${c.instrumentNumber ? `, Instrument No. ${c.instrumentNumber}` : ""}.` : "";
  const notePart = c.dataQualityNote ? ` ${c.dataQualityNote}` : "";

  return `Real Hidalgo County foreclosure notice: this property ${addressPart} is scheduled for foreclosure sale on ${c.saleDateISO}. The notice identifies ${c.grantorNames} as the grantor/mortgagor and ${c.currentMortgagee} as the current mortgagee. ${dotPart} ${principalPart}${notePart}`.replace(/\s+/g, " ").trim();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
