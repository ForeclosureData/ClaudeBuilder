import { PDFDocument } from "pdf-lib";

/** Copies a 1-indexed, inclusive page range out of a source PDF into a standalone PDF — used to give each split-out notice its own storable/linkable document, distinct from the monthly bundle. */
export async function extractPageRangeAsPdf(sourceBytes: Buffer, startPage: number, endPage: number): Promise<Buffer> {
  const src = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  const out = await PDFDocument.create();
  const indices: number[] = [];
  for (let p = startPage; p <= endPage; p++) indices.push(p - 1);
  const pages = await out.copyPages(src, indices);
  for (const page of pages) out.addPage(page);
  const bytes = await out.save();
  return Buffer.from(bytes);
}
