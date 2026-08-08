import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@foreclosuredata/database";
import {
  DocumentProcessingStatus,
  DocumentType,
  IngestedBundleStatus,
  ManualReviewReason,
  ManualReviewStatus,
  ManualReviewTaskStatus,
  OrganizationType,
  PartyEntityType,
  PropertyClassification,
  SaleStatus,
  CancellationStatus,
} from "@prisma/client";
import type { CountyForeclosureAdapter, DiscoveredNotice } from "@foreclosuredata/county-adapters";
import {
  runExtractionPipeline,
  resolvePropertyAddress,
  parseLegalDescription,
  detectStatedPropertyAddress,
  generateForeclosureSummary,
  estimateRemainingBalance,
  type ResolutionInput,
  type RequestBudget,
} from "@foreclosuredata/foreclosure-core";
import type { AppraisalValueYear } from "@foreclosuredata/types";
import { getCountyAppraisalAdapter } from "../appraisal";

export interface NoticeReportEntry {
  documentNumber: string | null;
  bundleUrl: string;
  pageRange: string | null;
  outcome: "persisted" | "duplicate" | "extraction_failed" | "low_confidence_transcription" | "failed";
  saleDateIso: string | null;
  legalDescriptionSummary: string | null;
  addressResolutionMethod: string | null;
  addressResolutionConfidence: number | null;
  manualReviewReasons: string[];
  overallExtractionConfidence: number | null;
  aiFallbackUsed: boolean;
  /** Set when an AI fallback call spent budget but its result couldn't be merged (bad JSON/schema mismatch) -- surfaced so a run's spend is never silently unaccounted for. */
  aiFailureReason?: string;
}

export interface IngestionRunSummary {
  countyId: string;
  countySlug: string;
  adapterKey: string;
  bundlesDiscovered: number;
  bundlesProcessed: number;
  bundlesSkippedUnchanged: number;
  bundlesFailed: number;
  noticesSplit: number;
  noticesTranscriptionLowConfidence: number;
  noticesExtracted: number;
  noticesDuplicate: number;
  noticesPersisted: number;
  /** Notices whose processing threw an unexpected error (e.g. a data-shape surprise from an upstream source) -- recorded and skipped rather than aborting the whole run. */
  noticesFailed: number;
  noticesRequiringManualReview: number;
  /** Notices whose content came from local OCR (adapter-reported contentSource === "ocr"). 0 for adapters/runs that don't use OCR. */
  noticesOcrSuccess: number;
  /** Notices whose content fell back to Claude vision because OCR confidence/text length looked untrustworthy. */
  noticesContentClaudeFallback: number;
  /** Average OCR confidence (0-100) across notices that reported one; null if none did. */
  averageOcrConfidence: number | null;
  /** How many Claude field-extraction fallback calls were actually made this run (bounded by maxAiFallbackCallsPerRun). */
  aiFallbackCallCount: number;
  /** True if a run-level AI budget/call cap (not just the monthly budget) stopped further fallback calls before every eligible notice got one. */
  aiBudgetExhausted: boolean;
  aiCostCents: number;
  errors: string[];
  perNoticeReport: NoticeReportEntry[];
}

export interface IngestOptions {
  /** Caps notices split per bundle — used to bound cost/time for supervised test runs. Unbounded when omitted, which is what the 6-hour scheduled poll uses. */
  maxNoticesPerBundle?: number;
  /** Caps how many bundles are processed in this run. */
  maxBundles?: number;
  /** Local OCR function (e.g. ocrPages from @foreclosuredata/county-adapters' hidalgo/ocr.ts), forwarded to the adapter's splitBundle. Omitted entirely by callers that shouldn't/can't use local OCR (e.g. the Netlify-hosted scheduled trigger). */
  ocr?: (pngBuffers: Buffer[]) => Promise<{ text: string; confidence: number }>;
  ocrConfidenceThreshold?: number;
  /** Render scale used for barcode/boundary scanning, forwarded to adapters that support it. */
  barcodeScanScale?: number;
  /** Hard cap on Claude field-extraction fallback calls for this whole run, independent of the monthly dollar budget — a pilot-phase safety net given a small test API balance. Unbounded when omitted. */
  maxAiFallbackCallsPerRun?: number;
  /** Hard cap on Claude field-extraction spend (in cents) for this whole run. Unbounded when omitted (still subject to the monthly AI_EXTRACTION_MONTHLY_BUDGET_CENTS ceiling). */
  maxAiCostPerRunCents?: number;
}

const AI_MONTHLY_BUDGET_CENTS = Number(process.env.AI_EXTRACTION_MONTHLY_BUDGET_CENTS ?? 5000);

export async function ingestForeclosureNotices(
  countySlug: string,
  adapter: CountyForeclosureAdapter,
  options: IngestOptions = {},
): Promise<IngestionRunSummary> {
  const county = await prisma.county.findUnique({ where: { slug: countySlug } });
  if (!county) throw new Error(`No County row for slug "${countySlug}" — seed it before ingesting.`);

  const summary: IngestionRunSummary = {
    countyId: county.id,
    countySlug,
    adapterKey: adapter.adapterKey,
    bundlesDiscovered: 0,
    bundlesProcessed: 0,
    bundlesSkippedUnchanged: 0,
    bundlesFailed: 0,
    noticesSplit: 0,
    noticesTranscriptionLowConfidence: 0,
    noticesExtracted: 0,
    noticesDuplicate: 0,
    noticesPersisted: 0,
    noticesFailed: 0,
    noticesRequiringManualReview: 0,
    noticesOcrSuccess: 0,
    noticesContentClaudeFallback: 0,
    averageOcrConfidence: null,
    aiFallbackCallCount: 0,
    aiBudgetExhausted: false,
    aiCostCents: 0,
    errors: [],
    perNoticeReport: [],
  };

  let discovered: DiscoveredNotice[];
  try {
    discovered = await adapter.discoverNotices({});
  } catch (err) {
    summary.errors.push(`discoverNotices failed: ${errMessage(err)}`);
    return summary;
  }
  summary.bundlesDiscovered = discovered.length;

  const bundlesToProcess = options.maxBundles ? discovered.slice(0, options.maxBundles) : discovered;

  const appraisalAdapter = getCountyAppraisalAdapter(countySlug);
  let ocrConfidenceSum = 0;
  let ocrConfidenceCount = 0;
  let spentThisRunCents = 0;
  let aiCallCount = 0;
  const maxAiCostPerRunCents = options.maxAiCostPerRunCents ?? Infinity;
  const maxAiFallbackCallsPerRun = options.maxAiFallbackCallsPerRun ?? Infinity;
  const budget = {
    // Checked BEFORE each Claude field-extraction call — three independent
    // ceilings (monthly dollar budget, this run's dollar cap, this run's
    // call-count cap) all have to allow it, or the field stays
    // null/low-confidence and flows to manual review instead of spending.
    async hasHeadroom(): Promise<boolean> {
      const withinMonthlyBudget = spentThisRunCents < AI_MONTHLY_BUDGET_CENTS;
      const withinRunCostCap = spentThisRunCents < maxAiCostPerRunCents;
      const withinRunCallCap = aiCallCount < maxAiFallbackCallsPerRun;
      if (!withinRunCostCap || !withinRunCallCap) summary.aiBudgetExhausted = true;
      return withinMonthlyBudget && withinRunCostCap && withinRunCallCap;
    },
    async recordSpend(costCents: number): Promise<void> {
      aiCallCount++;
      spentThisRunCents += costCents;
      summary.aiCostCents += costCents;
      summary.aiFallbackCallCount = aiCallCount;
    },
  };

  for (const notice of bundlesToProcess) {
    let bundleRecord = await prisma.ingestedNoticeBundle.findUnique({
      where: { countyId_adapterKey_externalId: { countyId: county.id, adapterKey: adapter.adapterKey, externalId: notice.externalId } },
    });

    let downloaded;
    try {
      downloaded = await adapter.downloadNotice(notice);
    } catch (err) {
      summary.bundlesFailed++;
      summary.errors.push(`downloadNotice(${notice.externalId}) failed: ${errMessage(err)}`);
      continue;
    }

    const bundleSha256 = createHash("sha256").update(downloaded.fileBuffer).digest("hex");

    if (bundleRecord?.status === IngestedBundleStatus.SPLIT_COMPLETE && bundleRecord.bundleSha256 === bundleSha256) {
      summary.bundlesSkippedUnchanged++;
      await prisma.ingestedNoticeBundle.update({ where: { id: bundleRecord.id }, data: { lastCheckedAt: new Date() } });
      continue;
    }

    bundleRecord = await prisma.ingestedNoticeBundle.upsert({
      where: { countyId_adapterKey_externalId: { countyId: county.id, adapterKey: adapter.adapterKey, externalId: notice.externalId } },
      create: {
        countyId: county.id,
        adapterKey: adapter.adapterKey,
        externalId: notice.externalId,
        sourceUrl: notice.sourceUrl,
        documentUrl: notice.documentUrl,
        bundleSha256,
        status: IngestedBundleStatus.SPLITTING,
      },
      update: { bundleSha256, status: IngestedBundleStatus.SPLITTING, lastCheckedAt: new Date() },
    });

    if (!adapter.splitBundle) {
      summary.bundlesFailed++;
      summary.errors.push(`Adapter "${adapter.adapterKey}" has no splitBundle(); cannot process bundled documents.`);
      continue;
    }

    let splitNotices;
    try {
      // maxNotices is enforced INSIDE splitBundle (it stops issuing further
      // AI calls once it's hit), not by slicing the result afterward —
      // slicing after the fact would still have paid for every notice in
      // the bundle before throwing most of them away.
      splitNotices = await adapter.splitBundle(downloaded, {
        maxNotices: options.maxNoticesPerBundle,
        onCost: (costCents) => {
          summary.aiCostCents += costCents;
        },
        ocr: options.ocr,
        ocrConfidenceThreshold: options.ocrConfidenceThreshold,
        barcodeScanScale: options.barcodeScanScale,
      });
    } catch (err) {
      summary.bundlesFailed++;
      summary.errors.push(`splitBundle(${notice.externalId}) failed: ${errMessage(err)}`);
      await prisma.ingestedNoticeBundle.update({
        where: { id: bundleRecord.id },
        data: { status: IngestedBundleStatus.FAILED, errorMessage: errMessage(err) },
      });
      continue;
    }

    const bounded = splitNotices;
    summary.noticesSplit += bounded.length;
    summary.bundlesProcessed++;

    for (const bundledNotice of bounded) {
      if (bundledNotice.lowConfidence) summary.noticesTranscriptionLowConfidence++;
      if (bundledNotice.contentSource === "ocr") summary.noticesOcrSuccess++;
      else if (bundledNotice.contentSource === "claude_vision") summary.noticesContentClaudeFallback++;
      if (typeof bundledNotice.ocrConfidence === "number") {
        ocrConfidenceSum += bundledNotice.ocrConfidence;
        ocrConfidenceCount++;
      }

      // A single notice's unexpected failure (e.g. an upstream data-shape
      // surprise) must never abort the rest of the batch -- recorded as one
      // "failed" outcome and the loop continues to the next notice, so a
      // bounded run's failure count is accurate instead of the whole run
      // dying partway through.
      let entry: { report: NoticeReportEntry };
      try {
        entry = await processSingleNotice({
          county,
          countySourceKey: adapter.adapterKey,
          bundleSourceUrl: notice.sourceUrl,
          bundledNotice,
          appraisalAdapter,
          budget,
        });
      } catch (err) {
        summary.noticesFailed++;
        summary.errors.push(`processSingleNotice(${bundledNotice.countyFilingNumber ?? bundledNotice.externalId}) failed: ${errMessage(err)}`);
        summary.perNoticeReport.push({
          documentNumber: bundledNotice.countyFilingNumber,
          bundleUrl: notice.sourceUrl,
          pageRange: null,
          outcome: "failed",
          saleDateIso: null,
          legalDescriptionSummary: null,
          addressResolutionMethod: null,
          addressResolutionConfidence: null,
          manualReviewReasons: [],
          overallExtractionConfidence: null,
          aiFallbackUsed: false,
        });
        continue;
      }
      summary.perNoticeReport.push(entry.report);
      if (entry.report.outcome === "duplicate") summary.noticesDuplicate++;
      else if (entry.report.outcome === "persisted") {
        summary.noticesPersisted++;
        summary.noticesExtracted++;
        if (entry.report.manualReviewReasons.length > 0) summary.noticesRequiringManualReview++;
      } else if (entry.report.outcome === "extraction_failed") {
        summary.errors.push(`Extraction failed for ${entry.report.documentNumber ?? "unknown doc"}: persisted with LOW_CONFIDENCE flag`);
      }
      if (entry.report.aiFailureReason) {
        summary.errors.push(`AI fallback spent budget but did not merge for ${entry.report.documentNumber ?? "unknown doc"}: ${entry.report.aiFailureReason}`);
      }
    }

    // A bounded/supervised test run (maxNoticesPerBundle set) only ever
    // processes a prefix of the bundle — marking it SPLIT_COMPLETE would
    // make the real unbounded run skip it later and silently leave the
    // rest of the bundle unprocessed. Only the unbounded path (how the
    // scheduler calls this) marks it complete; a bounded run leaves the
    // bundle in SPLITTING so the next unbounded run reprocesses it (safe —
    // already-persisted notices are still deduped by sha256Hash).
    if (options.maxNoticesPerBundle === undefined) {
      await prisma.ingestedNoticeBundle.update({
        where: { id: bundleRecord.id },
        data: {
          status: IngestedBundleStatus.SPLIT_COMPLETE,
          noticeCount: splitNotices.length,
          splitSuccessCount: bounded.length,
          processedAt: new Date(),
        },
      });
    } else {
      await prisma.ingestedNoticeBundle.update({
        where: { id: bundleRecord.id },
        data: { noticeCount: splitNotices.length, splitSuccessCount: bounded.length, lastCheckedAt: new Date() },
      });
    }
  }

  if (ocrConfidenceCount > 0) summary.averageOcrConfidence = ocrConfidenceSum / ocrConfidenceCount;

  return summary;
}

async function processSingleNotice(params: {
  county: { id: string; slug: string };
  countySourceKey: string;
  bundleSourceUrl: string;
  bundledNotice: Awaited<ReturnType<NonNullable<CountyForeclosureAdapter["splitBundle"]>>>[number];
  appraisalAdapter: Parameters<typeof resolvePropertyAddress>[1];
  budget: { hasHeadroom(estimatedInputChars: number): Promise<boolean>; recordSpend(costCents: number): Promise<void> };
}): Promise<{ report: NoticeReportEntry }> {
  const { county, bundledNotice } = params;
  const pageRangeText = null; // page range isn't threaded through BundledNotice today; see documentUrl/countyFilingNumber for provenance instead.

  const dedupHash = createHash("sha256")
    .update(bundledNotice.fileBuffer ?? Buffer.from(bundledNotice.noticeText, "utf8"))
    .digest("hex");

  const existing = await prisma.sourceDocument.findUnique({ where: { sha256Hash: dedupHash } });
  if (existing) {
    return {
      report: {
        documentNumber: bundledNotice.countyFilingNumber,
        bundleUrl: params.bundleSourceUrl,
        pageRange: pageRangeText,
        outcome: "duplicate",
        saleDateIso: null,
        legalDescriptionSummary: null,
        addressResolutionMethod: null,
        addressResolutionConfidence: null,
        manualReviewReasons: [],
        overallExtractionConfidence: null,
        aiFallbackUsed: false,
      },
    };
  }

  const pipelineResult = await runExtractionPipeline(bundledNotice.noticeText, params.budget);
  const extracted = pipelineResult.extracted;

  const legalDescription = parseLegalDescription(bundledNotice.noticeText);
  const statedAddress = detectStatedPropertyAddress(bundledNotice.noticeText);

  const resolutionInput: ResolutionInput = {
    statedPropertyAddress: statedAddress?.text ?? null,
    statedAddressMethod: statedAddress?.method ?? null,
    legalDescription: legalDescription
      ? { rawText: legalDescription.rawText, subdivision: legalDescription.subdivision, lot: legalDescription.lot, block: legalDescription.block, acreage: legalDescription.acreage }
      : null,
    ownerNames: extracted.grantorNames.value ?? extracted.borrowerNames.value ?? [],
    ownerMailingAddress: null,
    propertyIdFromNotice: extracted.propertyId.value,
    geographicIdFromNotice: null,
    city: null,
  };

  const cadBudget: RequestBudget = { remaining: Number(process.env.HIDALGO_CAD_MAX_REQUESTS_PER_NOTICE ?? 10) };
  const resolution = await resolvePropertyAddress(resolutionInput, params.appraisalAdapter, undefined, cadBudget);
  // The candidate the resolver already confidently selected -- either as
  // the resolution method itself (no notice address) or as enrichment for
  // an explicit-stated-address case. Never re-decided here; this function
  // only persists what resolver.ts + scoring.ts already determined.
  const selectedCandidate = resolution.selectedCandidate;

  const grantorName = (extracted.grantorNames.value ?? extracted.borrowerNames.value ?? []).join(", ") || "Unknown owner";
  const grantor = await prisma.person.create({ data: { fullName: grantorName } });

  // Original mortgagee (who made the loan), current mortgagee (who's actually
  // foreclosing now), and mortgage servicer are three distinct parties that
  // are frequently different companies -- never collapsed into one
  // Organization row. A field stays null (not a placeholder "Unknown ..."
  // org) when the notice didn't state it, matching the property page's own
  // `?? "Unknown"` display fallback.
  const originalLenderOrg = extracted.originalMortgagee.value
    ? await prisma.organization.create({ data: { name: extracted.originalMortgagee.value, type: OrganizationType.LENDER } })
    : null;
  const currentMortgageeOrg = extracted.currentMortgagee.value
    ? await prisma.organization.create({ data: { name: extracted.currentMortgagee.value, type: OrganizationType.LENDER } })
    : null;
  const mortgageServicerOrg = extracted.mortgageServicer.value
    ? await prisma.organization.create({ data: { name: extracted.mortgageServicer.value, type: OrganizationType.SERVICER } })
    : null;

  let property: { id: string } | null = null;
  if (resolution.address.resolvedAddress || resolution.address.addressResolutionMethod !== "UNRESOLVED") {
    property = await prisma.property.create({
      data: {
        countyId: county.id,
        propertyStreetAddress: resolution.address.resolvedAddress,
        // CAD-verified identity fields (from the already-selected candidate)
        // take priority over the notice's own transcribed legal description
        // when both exist -- the CAD record is the authoritative source for
        // parcel/geo IDs and is at least as reliable for subdivision/lot/
        // block. Never invents these when there's no selected candidate.
        subdivision: selectedCandidate?.subdivision ?? legalDescription?.subdivision ?? null,
        lot: selectedCandidate?.lot ?? legalDescription?.lot ?? null,
        block: selectedCandidate?.block ?? legalDescription?.block ?? null,
        acreage: selectedCandidate?.acreage ?? null,
        propertyIdNumber: selectedCandidate?.parcelId ?? null,
        geographicId: selectedCandidate?.geographicId ?? null,
        latitude: selectedCandidate?.latitude ?? null,
        longitude: selectedCandidate?.longitude ?? null,
        propertyType: "UNKNOWN",
        classification: PropertyClassification.UNKNOWN,
        addressResolutionMethod: resolution.address.addressResolutionMethod as never,
        addressResolutionConfidence: resolution.address.addressResolutionConfidence,
        addressResolutionExplanation: resolution.address.addressResolutionExplanation,
      },
    });
  }

  const manualReviewReasons = [...pipelineResult.manualReviewReasons];
  if (!property) manualReviewReasons.push("NO_ADDRESS_RESOLVED");
  // The address itself is fine (explicit-stated-address cases always are),
  // but the CAD returned candidates for this notice's legal description/
  // owner that couldn't be confidently attached as enrichment -- surface it
  // for human review rather than silently publishing without county data.
  // A genuine current-owner conflict on an otherwise strong match gets its
  // own distinct reason (never auto-accepted regardless of score) so a
  // reviewer can tell "the county record points at a different owner"
  // apart from ordinary ambiguity.
  if (property && !selectedCandidate && resolution.candidates.length > 0) {
    manualReviewReasons.push(resolution.ownerConflictOnBestMatch ? "CAD_OWNER_CONFLICT" : "MULTIPLE_APPRAISAL_MATCHES");
  }

  // extracted.*.value is expressed in whole dollars (see texasTemplates.ts,
  // which divides its internal cents figure by 100 before wrapping it as an
  // ExtractedValue) -- every *Cents column below needs the *100 back. A
  // previous version of this function passed the dollar figure straight
  // into *Cents fields/params, understating every stored and summarized
  // amount by 100x; fixed here.
  const originalPrincipalCents = extracted.originalPrincipalAmount.value !== null ? Math.round(extracted.originalPrincipalAmount.value * 100) : null;
  const statedCurrentBalanceCents = extracted.currentPrincipalBalance.value !== null ? Math.round(extracted.currentPrincipalBalance.value * 100) : null;

  const fc = await prisma.foreclosureCase.create({
    data: {
      countyId: county.id,
      propertyId: property?.id,
      caseNumber: bundledNotice.countyFilingNumber ? `HID-${bundledNotice.countyFilingNumber}` : null,
      status: SaleStatus.SCHEDULED,
      entityType: PartyEntityType.UNKNOWN,
      borrowerPersonId: grantor.id,
      grantorPersonId: grantor.id,
      currentOwnerPersonId: grantor.id,
      summaryText: generateForeclosureSummary({
        classification: "UNKNOWN",
        propertyAddress: resolution.address.resolvedAddress,
        city: null,
        subdivision: legalDescription?.subdivision ?? null,
        saleDateIso: extracted.saleDate.value,
        borrowerName: grantorName,
        lenderName: extracted.lenderName.value,
        originalLoanDateIso: extracted.deedOfTrustDate.value,
        originalPrincipalCents,
        currentBalanceStatedCents: statedCurrentBalanceCents,
        addressResolutionMethod: resolution.address.addressResolutionMethod as never,
      }),
      lastVerifiedAt: new Date(),
    },
  });

  const doc = await prisma.sourceDocument.create({
    data: {
      countyId: county.id,
      foreclosureCaseId: fc.id,
      sourceUrl: params.bundleSourceUrl,
      documentUrl: params.bundleSourceUrl,
      filename: bundledNotice.countyFilingNumber ? `Doc-${bundledNotice.countyFilingNumber}.pdf` : `${bundledNotice.externalId}.pdf`,
      countyFilingNumber: bundledNotice.countyFilingNumber,
      filingDate: bundledNotice.filingDate,
      documentType: DocumentType.NOTICE_OF_TRUSTEE_SALE,
      dateCollected: new Date(),
      sha256Hash: dedupHash,
      extractionConfidence: pipelineResult.overallConfidence,
      manualReviewStatus: manualReviewReasons.length > 0 ? ManualReviewStatus.PENDING : ManualReviewStatus.NOT_NEEDED,
      status: pipelineResult.usedAiFallback ? DocumentProcessingStatus.AI_EXTRACTED : DocumentProcessingStatus.DETERMINISTIC_EXTRACTED,
      ocrUsed: true,
      processingCostCents: pipelineResult.aiCostCents,
      rawText: bundledNotice.noticeText,
    },
  });

  if (extracted.saleDate.value) {
    await prisma.foreclosureSale.create({
      data: {
        foreclosureCaseId: fc.id,
        sourceDocumentId: doc.id,
        saleDate: new Date(extracted.saleDate.value),
        saleTime: extracted.saleTime.value,
        saleLocation: extracted.saleLocation.value,
        earliestSaleDate: new Date(extracted.saleDate.value),
        saleStatus: SaleStatus.SCHEDULED,
        cancellationStatus: CancellationStatus.NOT_CANCELED,
      },
    });
  }

  // Only estimate a remaining balance when the notice didn't already state
  // one and there's enough to model from (original principal + the deed of
  // trust date) -- never fabricated from partial data, and never confused
  // with the original principal itself.
  const balanceEstimate =
    statedCurrentBalanceCents === null && originalPrincipalCents !== null && extracted.deedOfTrustDate.value
      ? estimateRemainingBalance({ originalPrincipalCents, originalLoanDateIso: extracted.deedOfTrustDate.value })
      : null;

  await prisma.loan.create({
    data: {
      foreclosureCaseId: fc.id,
      originalLenderOrgId: originalLenderOrg?.id,
      currentMortgageeOrgId: currentMortgageeOrg?.id,
      mortgageServicerOrgId: mortgageServicerOrg?.id,
      originalPrincipalAmountCents: originalPrincipalCents,
      deedOfTrustDate: extracted.deedOfTrustDate.value ? new Date(extracted.deedOfTrustDate.value) : null,
      instrumentNumber: extracted.instrumentNumber.value,
      recordingDate: extracted.recordingDate.value ? new Date(extracted.recordingDate.value) : null,
      currentPrincipalBalanceCents: statedCurrentBalanceCents,
      estimatedRemainingBalanceCents: balanceEstimate?.estimatedRemainingBalanceCents ?? null,
      remainingBalanceMethodology: balanceEstimate?.methodology ?? null,
      remainingBalanceConfidence: balanceEstimate?.confidence ?? null,
      remainingBalanceAssumptions: (balanceEstimate?.assumptions as Prisma.InputJsonValue | undefined) ?? undefined,
    },
  });

  if (property) {
    await prisma.propertyAddress.create({
      data: {
        foreclosureCaseId: fc.id,
        propertyId: property.id,
        rawAddressText: resolution.address.resolvedAddress ?? legalDescription?.rawText ?? "Unresolved",
        method: resolution.address.addressResolutionMethod as never,
        confidence: resolution.address.addressResolutionConfidence,
        explanation: resolution.address.addressResolutionExplanation,
        isSelected: true,
      },
    });
  }

  if (legalDescription) {
    await prisma.legalDescription.create({
      data: {
        foreclosureCaseId: fc.id,
        sourceDocumentId: doc.id,
        rawText: legalDescription.rawText,
        subdivision: legalDescription.subdivision,
        lot: legalDescription.lot,
        block: legalDescription.block,
      },
    });
  }

  // Persist every CAD candidate the resolver gathered (not just the
  // selected one) -- same shape /admin/property-resolution's own
  // "search again" action already writes, so a case that needs manual
  // review shows real ingestion-time candidates/scoring immediately,
  // without a human having to trigger a live re-search first.
  if (resolution.candidates.length > 0) {
    await prisma.appraisalPropertyCandidate.createMany({
      data: resolution.candidates.map((c) => ({
        foreclosureCaseId: fc.id,
        countyAppraisalSourceKey: params.appraisalAdapter.countyCode,
        sourcePropertyId: c.sourcePropertyId,
        sourceUrl: c.sourceUrl ?? null,
        ownerName: c.ownerName,
        situsAddress: c.situsAddress,
        city: c.city,
        zipCode: c.zipCode,
        parcelId: c.parcelId,
        geographicId: c.geographicId,
        legalDescription: c.legalDescription,
        subdivision: c.subdivision,
        lot: c.lot,
        block: c.block,
        acreage: c.acreage,
        classification: c.classification,
        landValueCents: c.landValueCents,
        improvementValueCents: c.improvementValueCents,
        appraisedValueCents: c.appraisedValueCents,
        assessedValueCents: c.assessedValueCents,
        marketValueCents: c.marketValueCents,
        homestead: c.homestead,
        taxYear: c.taxYear,
        latitude: c.latitude,
        longitude: c.longitude,
        isSelected: c.sourcePropertyId === selectedCandidate?.sourcePropertyId,
      })),
    });
    await prisma.propertyResolutionAttempt.create({
      data: {
        foreclosureCaseId: fc.id,
        resolutionMethod: resolution.address.addressResolutionMethod as never,
        confidence: resolution.resolution.confidence,
        explanation: resolution.resolution.explanation,
        matchedFields: resolution.resolution.matchedFields,
        conflictingFields: resolution.resolution.conflictingFields,
        candidateCount: resolution.resolution.candidateCount,
        requiresManualReview: resolution.resolution.requiresManualReview,
        selectedCandidateId: resolution.resolution.selectedCandidateId,
      },
    });
  }

  // Annual county values for the selected property -- only years the CAD
  // actually returned populated data for (see getValuationHistory's
  // year-walkback). Upserted rather than blindly created so a re-run
  // never duplicates a row for the same (property, taxYear), and a
  // certified year's values are never touched once written -- the update
  // branch below writes the identical figures back, so nothing is ever
  // silently overwritten with different data for an already-certified year.
  if (property && selectedCandidate && typeof params.appraisalAdapter.getValuationHistory === "function") {
    let valuationYears: AppraisalValueYear[] = [];
    try {
      valuationYears = await params.appraisalAdapter.getValuationHistory(selectedCandidate.sourcePropertyId, { budget: cadBudget });
    } catch {
      // Valuation lookup is best-effort enrichment -- a failure here must
      // never fail the whole notice's ingestion.
    }
    for (const year of valuationYears.filter((y) => y.populated)) {
      const historyData = {
        taxYear: year.taxYear,
        landValueCents: year.landValueCents,
        improvementValueCents: year.improvementValueCents,
        appraisedValueCents: year.appraisedValueCents,
        assessedValueCents: year.assessedValueCents,
        marketValueCents: year.marketValueCents,
        certified: year.certified,
        sourceUrl: year.sourceUrl,
      };
      await prisma.appraisalValueHistory.upsert({
        where: { propertyId_taxYear: { propertyId: property.id, taxYear: year.taxYear } },
        create: { propertyId: property.id, ...historyData },
        update: historyData,
      });
    }
  }

  for (const reason of manualReviewReasons) {
    await prisma.manualReviewTask.create({
      data: {
        sourceDocumentId: doc.id,
        foreclosureCaseId: fc.id,
        reason: reason as ManualReviewReason,
        status: ManualReviewTaskStatus.OPEN,
        notes: `Automatically flagged during live Hidalgo ingestion (Doc-${bundledNotice.countyFilingNumber ?? "unknown"}).`,
      },
    });
  }

  return {
    report: {
      documentNumber: bundledNotice.countyFilingNumber,
      bundleUrl: params.bundleSourceUrl,
      pageRange: pageRangeText,
      outcome: "persisted",
      saleDateIso: extracted.saleDate.value,
      legalDescriptionSummary: legalDescription
        ? `${legalDescription.subdivision ?? "(no subdivision)"} Lot ${legalDescription.lot ?? "?"} Block ${legalDescription.block ?? "?"}`
        : null,
      addressResolutionMethod: resolution.address.addressResolutionMethod,
      addressResolutionConfidence: resolution.address.addressResolutionConfidence,
      manualReviewReasons,
      overallExtractionConfidence: pipelineResult.overallConfidence,
      aiFallbackUsed: pipelineResult.usedAiFallback,
      aiFailureReason: pipelineResult.aiFailureReason,
    },
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
