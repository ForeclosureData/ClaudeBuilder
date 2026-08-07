import { loadPdf } from "./pdfRender";

/**
 * Splits Hidalgo's monthly bundled, scanned (no text layer) foreclosure-sale
 * PDF into individual notices, using the county clerk's own recording
 * cover sheet as the boundary marker. Every recorded document in the bundle
 * is preceded by a cover sheet stamped "Doc-XXXXXX" in the top-right corner
 * and stating "Number of Pages: N" — verified against a real August 2026
 * posting (Doc-117631, a 4-page "Notice of Substitute Trustee Sale").
 *
 * Because there is no text layer, boundary detection and transcription both
 * go through Claude vision (one call per candidate cover sheet, one call
 * per notice's content pages) rather than text-based pattern matching.
 */

export interface SplitNotice {
  documentNumber: string | null;
  pageStart: number;
  pageEnd: number;
  documentType: string | null;
  recordedOn: string | null;
  noticeText: string;
  costCents: number;
  /** True when the transcription came back too short/empty to trust — surfaced so the caller can route it to manual review rather than silently publishing thin data. */
  lowConfidence: boolean;
}

export interface SplitBundleResult {
  notices: SplitNotice[];
  totalPages: number;
  pagesConsumed: number;
  stoppedEarly: boolean;
  stopReason?: string;
}

export interface SplitBundleOptions {
  apiKey?: string;
  model?: string;
  /** Caps how many notices to split before stopping — used to bound cost/time for live testing. Unbounded (splits the whole bundle) when omitted. */
  maxNotices?: number;
  onCost?: (costCents: number) => void;
}

interface CoverSheetResult {
  documentNumber: string | null;
  numberOfPages: number | null;
  documentType: string | null;
  recordedOn: string | null;
  costCents: number;
  /** The model's raw text response — only useful for diagnosing a parse failure, not part of the "real" result. */
  rawResponse: string;
}

export async function splitHidalgoBundle(pdfBytes: Buffer, options: SplitBundleOptions = {}): Promise<SplitBundleResult> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { notices: [], totalPages: 0, pagesConsumed: 0, stoppedEarly: true, stopReason: "ANTHROPIC_API_KEY not configured" };
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const model = options.model ?? process.env.AI_EXTRACTION_MODEL ?? "claude-sonnet-5";

  const pdf = await loadPdf(pdfBytes);
  const notices: SplitNotice[] = [];
  let page = 1;
  let stoppedEarly = false;
  let stopReason: string | undefined;

  while (page <= pdf.numPages) {
    if (options.maxNotices !== undefined && notices.length >= options.maxNotices) {
      stoppedEarly = true;
      stopReason = `Reached maxNotices=${options.maxNotices} limit`;
      break;
    }

    const coverPng = await pdf.renderPageToPng(page, 1.6);
    const cover = await classifyCoverSheet(client, model, coverPng);
    options.onCost?.(cover.costCents);

    if (!cover.documentNumber || !cover.numberOfPages || cover.numberOfPages < 1) {
      // Doesn't look like a recording cover sheet where one was expected.
      // Stop rather than guess at page ranges — this and any remaining
      // pages in the bundle need manual attention.
      stoppedEarly = true;
      stopReason = `Page ${page} did not parse as a recording cover sheet (documentNumber=${cover.documentNumber}, numberOfPages=${cover.numberOfPages}). Raw model response: ${cover.rawResponse.slice(0, 500)}`;
      break;
    }

    const pageStart = page;
    const pageEnd = Math.min(pageStart + cover.numberOfPages - 1, pdf.numPages);
    const contentPageNumbers: number[] = [];
    for (let p = pageStart + 1; p <= pageEnd; p++) contentPageNumbers.push(p);

    const contentPngs = await Promise.all(contentPageNumbers.map((p) => pdf.renderPageToPng(p, 1.6)));
    const transcript = await transcribeNoticeContent(client, model, contentPngs);
    options.onCost?.(transcript.costCents);

    notices.push({
      documentNumber: cover.documentNumber,
      pageStart,
      pageEnd,
      documentType: cover.documentType,
      recordedOn: cover.recordedOn,
      noticeText: transcript.text,
      costCents: cover.costCents + transcript.costCents,
      lowConfidence: transcript.text.trim().length < 200,
    });

    page = pageEnd + 1;
  }

  return { notices, totalPages: pdf.numPages, pagesConsumed: page - 1, stoppedEarly, stopReason };
}

async function classifyCoverSheet(
  client: InstanceType<typeof import("@anthropic-ai/sdk").default>,
  model: string,
  pngBuffer: Buffer,
): Promise<CoverSheetResult> {
  const response = await client.messages.create({
    model,
    max_tokens: 300,
    system:
      "You read Hidalgo County, Texas recorder's-office cover sheets that precede each recorded document in a bundled PDF. Respond with ONLY a JSON object — no markdown fences, no commentary.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: pngBuffer.toString("base64") } },
          {
            type: "text",
            text:
              'Extract from this recorder\'s cover sheet: {"documentNumber": string|null (the "Doc-XXXXXX" stamp, digits only, no "Doc-" prefix), "numberOfPages": number|null (from "Number of Pages: N"), "documentType": string|null (the document title heading, e.g. "NOTICE OF FORECLOSURE"), "recordedOn": string|null (the "Recorded On" date/time, as written)}. If this page is NOT a recorder\'s cover sheet (e.g. it is a notice\'s body text, not a cover page), return {"documentNumber": null, "numberOfPages": null, "documentType": null, "recordedOn": null}.',
          },
        ],
      },
    ],
  });

  const raw = extractText(response);
  const costCents = estimateCostCents(response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);

  try {
    const parsed = JSON.parse(extractJsonBlock(raw)) as Partial<CoverSheetResult>;
    return {
      documentNumber: typeof parsed.documentNumber === "string" ? parsed.documentNumber.replace(/\D/g, "") || null : null,
      numberOfPages: typeof parsed.numberOfPages === "number" ? parsed.numberOfPages : null,
      documentType: typeof parsed.documentType === "string" ? parsed.documentType : null,
      recordedOn: typeof parsed.recordedOn === "string" ? parsed.recordedOn : null,
      costCents,
      rawResponse: raw,
    };
  } catch {
    return { documentNumber: null, numberOfPages: null, documentType: null, recordedOn: null, costCents, rawResponse: raw };
  }
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

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

/** Rough published per-token pricing, matching foreclosure-core's extractWithAI estimate — update if the configured model's pricing changes. */
function estimateCostCents(inputTokens: number, outputTokens: number): number {
  const inputCostPerMillionCents = 300;
  const outputCostPerMillionCents = 1500;
  const cost = (inputTokens / 1_000_000) * inputCostPerMillionCents + (outputTokens / 1_000_000) * outputCostPerMillionCents;
  return Math.round(cost);
}
