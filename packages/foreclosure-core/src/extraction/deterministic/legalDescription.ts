export interface ParsedLegalDescription {
  rawText: string;
  lot: string | null;
  block: string | null;
  subdivision: string | null;
  acreage: number | null;
  volume: string | null;
  page: string | null;
}

/** Extracts the "Legal Description:" block and pulls out lot/block/subdivision/acreage when present. */
export function parseLegalDescription(noticeText: string): ParsedLegalDescription | null {
  // Real Hidalgo notices most often introduce the legal description with
  // "Property To Be Sold - The property to be sold is described as
  // follows:" rather than a "Legal Description:" label -- confirmed
  // against real August 2026 postings, where only 1 of 5 sampled notices
  // used the "Legal Description:" label at all.
  const labeled =
    noticeText.match(/Legal Description:\s*([\s\S]{0,400}?)(?:\n\s*\n|Original Principal|Substitute Trustee|Date of Sale)/i) ??
    noticeText.match(/[Tt]he [Pp]roperty to be sold is described as follows:\s*([\s\S]{0,400}?)(?:\n\s*\n|Instrument to be Foreclosed|Original Principal|Substitute Trustee|Date of Sale)/i);
  const rawText = labeled ? labeled[1]!.replace(/\s+/g, " ").trim() : findLotBlockSentence(noticeText);
  if (!rawText) return null;

  const lot = rawText.match(/Lot\s+([A-Za-z0-9\-]+)/i)?.[1] ?? null;
  const block = rawText.match(/Block\s+([A-Za-z0-9\-]+)/i)?.[1] ?? null;
  const subdivision = extractSubdivisionName(rawText);
  const acreageMatch = rawText.match(/([\d.]+)\s*acres?/i);
  const acreage = acreageMatch ? Number(acreageMatch[1]) : null;
  const volume = rawText.match(/Volume\s+(\d+)/i)?.[1] ?? null;
  const page = rawText.match(/Page\s+(\d+)/i)?.[1] ?? null;

  return { rawText, lot, block, subdivision, acreage, volume, page };
}

// Case-insensitive, and includes every classification word the CAD-side
// parser (address-resolution/legalDescriptionParsing.ts) already handles --
// this file previously only recognized SUBDIVISION/ESTATES/ADDITION/PARK/
// PLAT, so a real name like "WOODLAWN ACRES" or "ATWOOD VILLAGE" never
// matched at all.
const SUBDIVISION_TRIGGER_RE =
  /,\s*([A-Z0-9 .'\-&]{4,}(?:SUBDIVISION|ESTATES|ADDITION|PARK|PLAT|ACRES|HEIGHTS|MEADOWS|VILLAGE|TOWNSITE|COVES?|PLACE))\b/i;
// Real Hidalgo notices commonly phrase this as "Lot N, [Block M,]
// SUBDIVISION NAME, an addition to the City of ..." -- the subdivision name
// itself frequently contains NONE of the classification words above (e.g.
// "SOL BRILLA UNIT VIII") or misspells one ("SUBDIVISON"), so it's
// captured directly from its position in that sentence rather than only by
// keyword. Checked first: it's structurally anchored to both ends (the
// Lot/Block clause and the literal "an addition" that follows), so it's
// more reliable than the bare keyword scan whenever both are present.
const SUBDIVISION_BEFORE_ADDITION_RE =
  /Lots?\s+[A-Za-z0-9\-]+(?:\s*\([A-Za-z0-9]+\))?,?\s*(?:Block\s+[A-Za-z0-9\-]+(?:\s*\([A-Za-z0-9]+\))?,?\s*)?([A-Z0-9 .'\-&]{3,80}?),\s*(?:an\s+)?addition\b/i;
// A trigger-word match that captured nothing but the boilerplate phrase
// itself (e.g. from "...WOODLAWN ACRES, AN ADDITION TO..." incorrectly
// matching the SECOND comma-clause instead of the first) isn't a real
// subdivision name -- reject it rather than storing "AN ADDITION".
const BOILERPLATE_ONLY_RE = /^(?:AN\s+)?ADDITION$/i;

function extractSubdivisionName(rawText: string): string | null {
  const beforeAddition = rawText.match(SUBDIVISION_BEFORE_ADDITION_RE)?.[1]?.trim();
  if (beforeAddition && !BOILERPLATE_ONLY_RE.test(beforeAddition)) return beforeAddition;
  const triggerWord = rawText.match(SUBDIVISION_TRIGGER_RE)?.[1]?.trim();
  if (triggerWord && !BOILERPLATE_ONLY_RE.test(triggerWord)) return triggerWord;
  return triggerWord ?? beforeAddition ?? null;
}

function findLotBlockSentence(text: string): string | null {
  // Block is genuinely absent from some real notices (e.g. "LOT 68, Sol
  // Brilla Subdivision Phase VII..."), and a spelled-out lot/block number
  // is often followed by a parenthetical digit ("Twenty-Eight (28)") --
  // both tolerated here so this still matches without requiring Block.
  const match = text.match(
    /(?:All of )?Lot\s+[A-Za-z0-9\-]+(?:\s*\([A-Za-z0-9]+\))?,?\s*(?:Block\s+[A-Za-z0-9\-]+(?:\s*\([A-Za-z0-9]+\))?,?\s*)?[^\n]{0,200}/i,
  );
  return match ? match[0].trim() : null;
}
