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

const prisma = new PrismaClient();

const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_ADMIN_ID = "00000000-0000-4000-8000-000000000002";

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
  await prisma.notificationPreference.upsert({
    where: { profileId: demoUser.id },
    update: {},
    create: { profileId: demoUser.id },
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

  // ── Case 1: high-confidence, fully resolved, residential ────────────
  await seedCase(hidalgo.id, {
    caseNumber: "HID-2026-000481",
    borrowerName: "John A. Smith",
    grantorName: "John A. Smith",
    ownerName: "John A. Smith",
    lenderName: "ABC Bank, N.A.",
    servicerName: "ABC Loan Servicing LLC",
    trusteeName: "Patricia Reyes",
    trusteeCompany: "Rio Grande Trustee Services",
    address: "1417 N Cage Blvd",
    city: "Pharr",
    zip: "78577",
    subdivision: "Sunrise Terrace Subdivision",
    lot: "14",
    block: "3",
    acreage: 0.21,
    propertyType: PropertyType.SINGLE_FAMILY,
    classification: PropertyClassification.RESIDENTIAL,
    appraisedValueCents: 18_500_00,
    principalCents: 185_000_00,
    loanDateISO: "2018-06-01",
    saleDateISO: "2026-09-01",
    saleTime: "10:00 AM",
    saleLocation: "Hidalgo County Courthouse, 100 N Closner Blvd, Edinburg, TX (or as designated by the Commissioners Court)",
    resolutionMethod: AddressResolutionMethod.LEGAL_DESCRIPTION_MATCH,
    resolutionConfidence: 0.93,
    resolutionExplanation:
      "Matched subdivision, lot, block, owner surname, and acreage to the county appraisal record.",
    extractionConfidence: 0.9,
    manualReview: false,
    ownerOccupied: true,
    homestead: true,
    currentBalanceStatedCents: null,
  });

  // ── Case 2: stated current balance, commercial, medium confidence ──
  await seedCase(hidalgo.id, {
    caseNumber: "HID-2026-000502",
    borrowerName: "Rio Valley Holdings LLC",
    grantorName: "Rio Valley Holdings LLC",
    ownerName: "Rio Valley Holdings LLC",
    lenderName: "Frontera Community Bank",
    servicerName: "Frontera Community Bank",
    trusteeName: "Marco Villareal",
    trusteeCompany: "Villareal Trustee Group",
    address: "2210 W Business 83",
    city: "McAllen",
    zip: "78501",
    subdivision: "McAllen Commercial Plat",
    lot: "6",
    block: "1",
    acreage: 0.85,
    propertyType: PropertyType.COMMERCIAL,
    classification: PropertyClassification.COMMERCIAL,
    appraisedValueCents: 62_000_00,
    principalCents: 410_000_00,
    loanDateISO: "2021-03-15",
    saleDateISO: "2026-09-01",
    saleTime: "10:00 AM",
    saleLocation: "Hidalgo County Courthouse, 100 N Closner Blvd, Edinburg, TX (or as designated by the Commissioners Court)",
    resolutionMethod: AddressResolutionMethod.EXPLICIT_STATED,
    resolutionConfidence: 0.98,
    resolutionExplanation:
      "Street address was explicitly stated in the foreclosure notice under a \"commonly known as\" clause.",
    extractionConfidence: 0.86,
    manualReview: false,
    ownerOccupied: false,
    homestead: false,
    currentBalanceStatedCents: 372_450_00,
  });

  // ── Case 3: low confidence / manual review, conflicting names ───────
  await seedCase(hidalgo.id, {
    caseNumber: "HID-2026-000517",
    borrowerName: "Maria G. Longoria",
    grantorName: "Maria G. Longoria-Cantu",
    ownerName: "Maria G. Longoria",
    lenderName: "Valley Trust Mortgage Co.",
    servicerName: "Valley Trust Mortgage Co.",
    trusteeName: "Substitute Trustee (name illegible in scan)",
    trusteeCompany: "South Texas Trustee Services",
    address: null,
    city: "Weslaco",
    zip: null,
    subdivision: "Las Palmas Estates",
    lot: "22",
    block: null,
    acreage: null,
    propertyType: PropertyType.UNKNOWN,
    classification: PropertyClassification.UNKNOWN,
    appraisedValueCents: null,
    principalCents: 142_000_00,
    loanDateISO: "2016-11-20",
    saleDateISO: "2026-09-01",
    saleTime: "10:00 AM",
    saleLocation: "Hidalgo County Courthouse, 100 N Closner Blvd, Edinburg, TX (or as designated by the Commissioners Court)",
    resolutionMethod: AddressResolutionMethod.UNRESOLVED,
    resolutionConfidence: 0.35,
    resolutionExplanation:
      "Legal description matched two plausible appraisal records with different street addresses in the same subdivision; borrower name on the notice does not exactly match the appraisal district owner name.",
    extractionConfidence: 0.42,
    manualReview: true,
    manualReviewReason: ManualReviewReason.BORROWER_NAME_CONFLICT,
    ownerOccupied: null,
    homestead: null,
    currentBalanceStatedCents: null,
  });

  // ── Case 4: canceled sale ────────────────────────────────────────────
  await seedCase(hidalgo.id, {
    caseNumber: "HID-2026-000455",
    borrowerName: "Robert & Linda Garza",
    grantorName: "Robert Garza",
    ownerName: "Robert & Linda Garza",
    lenderName: "Southland Mortgage Corp.",
    servicerName: "Southland Loan Servicing",
    trusteeName: "James Whitfield",
    trusteeCompany: "Whitfield & Associates Trustee Services",
    address: "614 E 5th St",
    city: "Mission",
    zip: "78572",
    subdivision: "Mission Original Townsite",
    lot: "9",
    block: "12",
    acreage: 0.18,
    propertyType: PropertyType.SINGLE_FAMILY,
    classification: PropertyClassification.RESIDENTIAL,
    appraisedValueCents: 15_200_00,
    principalCents: 128_000_00,
    loanDateISO: "2015-02-10",
    saleDateISO: "2026-08-04",
    saleTime: "10:00 AM",
    saleLocation: "Hidalgo County Courthouse, 100 N Closner Blvd, Edinburg, TX (or as designated by the Commissioners Court)",
    resolutionMethod: AddressResolutionMethod.PROPERTY_ID_MATCH,
    resolutionConfidence: 0.88,
    resolutionExplanation:
      "Property ID stated in the deed-of-trust reference matched a single appraisal district record.",
    extractionConfidence: 0.81,
    manualReview: false,
    ownerOccupied: true,
    homestead: true,
    currentBalanceStatedCents: null,
    canceled: true,
  });

  console.log("Seed complete.");
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

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
