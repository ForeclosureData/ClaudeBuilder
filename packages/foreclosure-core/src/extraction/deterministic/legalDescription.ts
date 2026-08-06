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
  const labeled = noticeText.match(/Legal Description:\s*([\s\S]{0,400}?)(?:\n\s*\n|Original Principal|Substitute Trustee|Date of Sale)/i);
  const rawText = labeled ? labeled[1]!.replace(/\s+/g, " ").trim() : findLotBlockSentence(noticeText);
  if (!rawText) return null;

  const lot = rawText.match(/Lot\s+([A-Za-z0-9\-]+)/i)?.[1] ?? null;
  const block = rawText.match(/Block\s+([A-Za-z0-9\-]+)/i)?.[1] ?? null;
  const subdivision = rawText.match(/,\s*([A-Z0-9 .'\-]{4,60}(?:SUBDIVISION|ESTATES|ADDITION|PARK|PLAT))/)?.[1]?.trim() ?? null;
  const acreageMatch = rawText.match(/([\d.]+)\s*acres?/i);
  const acreage = acreageMatch ? Number(acreageMatch[1]) : null;
  const volume = rawText.match(/Volume\s+(\d+)/i)?.[1] ?? null;
  const page = rawText.match(/Page\s+(\d+)/i)?.[1] ?? null;

  return { rawText, lot, block, subdivision, acreage, volume, page };
}

function findLotBlockSentence(text: string): string | null {
  const match = text.match(/Lot\s+[A-Za-z0-9\-]+,?\s*Block\s+[A-Za-z0-9\-]+[^\n]{0,200}/i);
  return match ? match[0].trim() : null;
}
