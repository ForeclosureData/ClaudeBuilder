import { loadPdf } from "./pdfRender";
import { detectDocumentBoundaries, boundariesToNoticeRanges } from "./barcodeSplit";

/**
 * Splits Hidalgo's monthly bundled, scanned (no text layer) foreclosure-sale
 * PDF into individual notices.
 *
 * Document boundaries are found deterministically via barcodeSplit.ts
 * instead of Claude vision -- confirmed against real postings with 100%
 * detection and zero false positives, at effectively zero marginal cost
 * since it runs entirely locally. If the scan finds no barcodes anywhere
 * in the bundle, this stops rather than guessing boundaries.
 *
 * Notice *content* extraction has two paths:
 *  - No `options.ocr` provided (this package's current Netlify deploy):
 *    Claude vision transcribes each notice's page images directly, same as
 *    before. This keeps the currently-deployed, already-verified-working
 *    Lambda bundle untouched.
 *  - `options.ocr` provided (e.g. `ocrPages` from ./ocr.ts, meant for
 *    local/worker execution -- see that file's comment for why it isn't
 *    wired into the Netlify bundle): local OCR runs first, at zero cost.
 *    Claude vision is used only as an explicit fallback when OCR
 *    confidence is too low to trust (see shouldFallbackToClaude).
 * This is a plain callback rather than a static import specifically so the
 * production Netlify bundle never has to resolve tesseract.js at all.
 */

export interface SplitNotice {
  documentNumber: string | null;
  pageStart: number;
  pageEnd: number;
  documentType: string | null;
  recordedOn: string | null;
  noticeText: string;
  costCents: number;
  /** Which path actually produced noticeText for this notice. */
  contentSource: "ocr" | "claude_vision" | "none";
  /** Tesseract's own confidence (0-100), only set when options.ocr was used. */
  ocrConfidence: number | null;
  /** True when the transcription came back too short/empty to trust, or the notice's page range exceeded the sanity limit (likely a missed barcode) -- surfaced so the caller can route it to manual review rather than silently publishing thin/uncertain data. */
  lowConfidence: boolean;
}

export interface SplitBundleResult {
  notices: SplitNotice[];
  totalPages: number;
  pagesConsumed: number;
  stoppedEarly: boolean;
  stopReason?: string;
  /** How many cover-sheet barcodes were decoded across the whole bundle. */
  barcodesDetected: number;
}

export interface OcrFunction {
  (pngBuffers: Buffer[]): Promise<{ text: string; confidence: number }>;
}

export interface SplitBundleOptions {
  apiKey?: string;
  model?: string;
  /** Caps how many notices to split before stopping -- used to bound cost/time for live testing. Unbounded (splits the whole bundle) when omitted. */
  maxNotices?: number;
  onCost?: (costCents: number) => void;
  /** A detected notice spanning more pages than this is flagged lowConfidence rather than trusted outright -- a real notice here is typically a handful of pages, so an outsized range usually means a cover sheet later in the range failed to decode. */
  maxPagesPerNotice?: number;
  /** Local OCR function. When provided, becomes the primary content-extraction path; see module comment. */
  ocr?: OcrFunction;
  /** OCR confidence (0-100) below which Claude vision is used as a fallback for that notice. Ignored when `ocr` is not provided. */
  ocrConfidenceThreshold?: number;
}

const DEFAULT_MAX_PAGES_PER_NOTICE = 20;
const DEFAULT_OCR_CONFIDENCE_THRESHOLD = 70;
const OCR_RENDER_SCALE = 2.0;
const CLAUDE_VISION_RENDER_SCALE = 1.6;

/** True when local OCR output isn't trustworthy enough to use as-is and Claude vision should read the pages instead. Exported for unit testing independent of a real Tesseract run. */
export function shouldFallbackToClaude(
  ocr: { text: string; confidence: number },
  threshold: number = DEFAULT_OCR_CONFIDENCE_THRESHOLD,
): boolean {
  return ocr.confidence < threshold || ocr.text.trim().length < 100;
}

export async function splitHidalgoBundle(pdfBytes: Buffer, options: SplitBundleOptions = {}): Promise<SplitBundleResult> {
  const pdf = await loadPdf(pdfBytes);

  const scan = await detectDocumentBoundaries({
    numPages: pdf.numPages,
    scanPageForBarcode: async (pageNumber) => (await pdf.scanPageForBarcodes(pageNumber))[0] ?? null,
  });

  if (scan.boundaries.length === 0) {
    return {
      notices: [],
      totalPages: pdf.numPages,
      pagesConsumed: 0,
      stoppedEarly: true,
      stopReason: "No cover-sheet barcodes detected anywhere in the bundle.",
      barcodesDetected: 0,
    };
  }

  const ranges = boundariesToNoticeRanges(scan.boundaries, pdf.numPages);
  const maxPagesPerNotice = options.maxPagesPerNotice ?? DEFAULT_MAX_PAGES_PER_NOTICE;
  const ocrConfidenceThreshold = options.ocrConfidenceThreshold ?? DEFAULT_OCR_CONFIDENCE_THRESHOLD;

  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const model = options.model ?? process.env.AI_EXTRACTION_MODEL ?? "claude-sonnet-5";
  let client: InstanceType<typeof import("@anthropic-ai/sdk").default> | null = null;

  const notices: SplitNotice[] = [];
  let stoppedEarly = false;
  let stopReason: string | undefined;
  let pagesConsumed = 0;

  const ensureClient = async () => {
    if (!client) {
      if (!apiKey) return null;
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      client = new Anthropic({ apiKey });
    }
    return client;
  };

  for (const range of ranges) {
    if (options.maxNotices !== undefined && notices.length >= options.maxNotices) {
      stoppedEarly = true;
      stopReason = `Reached maxNotices=${options.maxNotices} limit`;
      break;
    }

    const contentPageNumbers: number[] = [];
    for (let p = range.pageStart + 1; p <= range.pageEnd; p++) contentPageNumbers.push(p);

    let noticeText = "";
    let costCents = 0;
    let contentSource: SplitNotice["contentSource"] = "none";
    let ocrConfidence: number | null = null;

    if (contentPageNumbers.length > 0) {
      if (options.ocr) {
        const ocrPngs = await Promise.all(contentPageNumbers.map((p) => pdf.renderPageToPng(p, OCR_RENDER_SCALE)));
        const ocrResult = await options.ocr(ocrPngs);
        ocrConfidence = ocrResult.confidence;

        if (!shouldFallbackToClaude(ocrResult, ocrConfidenceThreshold)) {
          noticeText = ocrResult.text;
          contentSource = "ocr";
        } else {
          const activeClient = await ensureClient();
          if (!activeClient) {
            stoppedEarly = true;
            stopReason = `Notice at page ${range.pageStart} needs Claude fallback (OCR confidence ${ocrResult.confidence.toFixed(1)}) but ANTHROPIC_API_KEY is not configured`;
            break;
          }
          const contentPngs = await Promise.all(contentPageNumbers.map((p) => pdf.renderPageToPng(p, CLAUDE_VISION_RENDER_SCALE)));
          const transcript = await transcribeNoticeContent(activeClient, model, contentPngs);
          noticeText = transcript.text;
          costCents = transcript.costCents;
          contentSource = "claude_vision";
          options.onCost?.(costCents);
        }
      } else {
        const activeClient = await ensureClient();
        if (!activeClient) {
          stoppedEarly = true;
          stopReason = "ANTHROPIC_API_KEY not configured for content transcription";
          break;
        }
        const contentPngs = await Promise.all(contentPageNumbers.map((p) => pdf.renderPageToPng(p, CLAUDE_VISION_RENDER_SCALE)));
        const transcript = await transcribeNoticeContent(activeClient, model, contentPngs);
        noticeText = transcript.text;
        costCents = transcript.costCents;
        contentSource = "claude_vision";
        options.onCost?.(costCents);
      }
    }

    const spanPages = range.pageEnd - range.pageStart + 1;
    notices.push({
      documentNumber: range.documentNumber,
      pageStart: range.pageStart,
      pageEnd: range.pageEnd,
      documentType: null,
      recordedOn: null,
      noticeText,
      costCents,
      contentSource,
      ocrConfidence,
      lowConfidence: noticeText.trim().length < 200 || spanPages > maxPagesPerNotice,
    });

    pagesConsumed = range.pageEnd;
  }

  return {
    notices,
    totalPages: pdf.numPages,
    pagesConsumed,
    stoppedEarly,
    stopReason,
    barcodesDetected: scan.barcodesFound,
  };
}

async function transcribeNoticeContent(
  client: InstanceType<typeof import("@anthropic-ai/sdk").default>,
  model: string,
  pngBuffers: Buffer[],
): Promise<{ text: string; costCents: number }> {
  if (pngBuffers.length === 0) return { text: "", costCents: 0 };

  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: [
          ...pngBuffers.map((b) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: "image/png" as const, data: b.toString("base64") },
          })),
          {
            type: "text" as const,
            text: "Transcribe the full plain text of this foreclosure notice from the page images above, in reading order, as accurately as possible. Output only the transcribed text, no commentary.",
          },
        ],
      },
    ],
  });

  return {
    text: extractText(response),
    costCents: estimateCostCents(response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0),
  };
}

function extractText(response: { content: Array<{ type: string; text?: string }> }): string {
  const block = response.content.find((b) => b.type === "text");
  return block?.text ?? "";
}

/** Rough published per-token pricing, matching foreclosure-core's extractWithAI estimate -- update if the configured model's pricing changes. */
function estimateCostCents(inputTokens: number, outputTokens: number): number {
  const inputCostPerMillionCents = 300;
  const outputCostPerMillionCents = 1500;
  const cost = (inputTokens / 1_000_000) * inputCostPerMillionCents + (outputTokens / 1_000_000) * outputCostPerMillionCents;
  return Math.round(cost);
}
