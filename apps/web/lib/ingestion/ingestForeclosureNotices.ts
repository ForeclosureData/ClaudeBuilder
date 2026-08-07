import { createHash } from "node:crypto";
import { prisma } from "@foreclosuredata/database";
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
  type ResolutionInput,
} from "@foreclosuredata/foreclosure-core";
import { getCountyAppraisalAdapter } from "@/lib/appraisal";

export interface NoticeReportEntry {
  documentNumber: string | null;
  bundleUrl: string;
  pageRange: string | null;
  outcome: "persisted" | "duplicate" | "extraction_failed" | "low_confidence_transcription";
  saleDateIso: string | null;
  legalDescriptionSummary: string | null;
  addressResolutionMethod: string | null;
  addressResolutionConfidence: number | null;
  manualReviewReasons: string[];
  overallExtractionConfidence: number | null;
  aiFallbackUsed: boolean;
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
  noticesRequiringManualReview: number;
  aiCostCents: number;
  errors: string[];
  perNoticeReport: NoticeReportEntry[];
}

export interface IngestOptions {
  /** Caps notices split per bundle — used to bound cost/time for supervised test runs. Unbounded when omitted, which is what the 6-hour scheduled poll uses. */
  maxNoticesPerBundle?: number;
  /** Caps how many bundles are processed in this run. */
  maxBundles?: number;
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
    noticesRequiringManualReview: 0,
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
  let spentThisRunCents = 0;
  const budget = {
    async hasHeadroom(): Promise<boolean> {
      return spentThisRunCents < AI_MONTHLY_BUDGET_CENTS;
    },
    async recordSpend(costCents: number): Promise<void> {
      spentThisRunCents += costCents;
      summary.aiCostCents += costCents;
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

      const entry = await processSingleNotice({
        county,
        countySourceKey: adapter.adapterKey,
        bundleSourceUrl: notice.sourceUrl,
        bundledNotice,
        appraisalAdapter,
        budget,
      });
      summary.perNoticeReport.push(entry.report);
      if (entry.report.outcome === "duplicate") summary.noticesDuplicate++;
      else if (entry.report.outcome === "persisted") {
        summary.noticesPersisted++;
        summary.noticesExtracted++;
        if (entry.report.manualReviewReasons.length > 0) summary.noticesRequiringManualReview++;
      } else if (entry.report.outcome === "extraction_failed") {
        summary.errors.push(`Extraction failed for ${entry.report.documentNumber ?? "unknown doc"}: persisted with LOW_CONFIDENCE flag`);
      }
    }

    await prisma.ingestedNoticeBundle.update({
      where: { id: bundleRecord.id },
      data: {
        status: IngestedBundleStatus.SPLIT_COMPLETE,
        noticeCount: splitNotices.length,
        splitSuccessCount: bounded.length,
        processedAt: new Date(),
      },
    });
  }

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

  const resolution = await resolvePropertyAddress(resolutionInput, params.appraisalAdapter);

  const grantorName = (extracted.grantorNames.value ?? extracted.borrowerNames.value ?? []).join(", ") || "Unknown owner";
  const grantor = await prisma.person.create({ data: { fullName: grantorName } });

  const lenderName = extracted.lenderName.value ?? "Unknown lender";
  const currentOrg = await prisma.organization.create({ data: { name: lenderName, type: OrganizationType.LENDER } });

  let property: { id: string } | null = null;
  if (resolution.address.resolvedAddress || resolution.address.addressResolutionMethod !== "UNRESOLVED") {
    property = await prisma.property.create({
      data: {
        countyId: county.id,
        propertyStreetAddress: resolution.address.resolvedAddress,
        subdivision: legalDescription?.subdivision ?? null,
        lot: legalDescription?.lot ?? null,
        block: legalDescription?.block ?? null,
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
        lenderName,
        originalLoanDateIso: extracted.deedOfTrustDate.value,
        originalPrincipalCents: extracted.originalPrincipalAmount.value,
        currentBalanceStatedCents: extracted.currentPrincipalBalance.value,
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

  await prisma.loan.create({
    data: {
      foreclosureCaseId: fc.id,
      originalLenderOrgId: currentOrg.id,
      currentMortgageeOrgId: currentOrg.id,
      originalPrincipalAmountCents: extracted.originalPrincipalAmount.value,
      deedOfTrustDate: extracted.deedOfTrustDate.value ? new Date(extracted.deedOfTrustDate.value) : null,
      instrumentNumber: extracted.instrumentNumber.value,
      recordingDate: extracted.recordingDate.value ? new Date(extracted.recordingDate.value) : null,
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
    },
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
