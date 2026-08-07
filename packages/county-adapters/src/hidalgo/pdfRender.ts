/**
 * Renders PDF pages to PNG using MuPDF (the `mupdf` npm package, an
 * official WASM build maintained by Artifex, MuPDF's own developers).
 *
 * Replaces an earlier pdfjs-dist + @napi-rs/canvas implementation that
 * rendered correctly in local/sandbox testing but produced completely
 * blank pages when actually deployed to Netlify's Lambda runtime —
 * confirmed by fetching a real rendered PNG from the deployed function.
 * These Hidalgo PDFs are scanned TIFF pages (Creator: Atalasoft dotImage
 * / tiff2pdf) with no vector content at all, so a failed page render
 * means zero visible content, not just a missing embedded image — pdf.js's
 * pure-JS JBIG2 fallback decoder was the suspected point of failure,
 * though the exact mechanism in Lambda specifically was never fully
 * isolated. MuPDF has its own native (C, compiled to WASM) JBIG2 decoder
 * rather than a JS reimplementation, and — unlike the earlier approach —
 * ships as a single self-contained WASM blob with no separate fallback/
 * worker files to route around bundlers, which was the recurring source
 * of packaging failures in the earlier implementation.
 *
 * Also exposes barcode scanning (scanPageForBarcodes) for deterministic
 * document-boundary detection -- see ./barcodeSplit.ts. Barcode scanning
 * renders at a higher scale (3.0, ~275 DPI) than the 1.6 (~150 DPI) used
 * for content PNGs: testing against the real bundle found zbar-wasm
 * detects zero symbols at 1.6 (bars too thin to resolve) but decodes
 * reliably at 3.0+. Each scan does its own render-and-destroy pixmap
 * rather than reusing one from renderPageToPng, because calling mupdf
 * again (e.g. asPNG()) after getPixels() can grow/realloc its WASM heap
 * and detach the previously-returned pixel view.
 */
import * as mupdf from "mupdf";
import { scanGrayBuffer } from "@undecaf/zbar-wasm";

export interface LoadedPdf {
  numPages: number;
  renderPageToPng(pageNumber: number, scale?: number): Promise<Buffer>;
  /** Decodes any barcodes present on the page (1-indexed) and returns their decoded text, in the order zbar reports them. Empty array if none found. */
  scanPageForBarcodes(pageNumber: number, scale?: number): Promise<string[]>;
}

const BARCODE_SCAN_SCALE = 3.0;

export async function loadPdf(pdfBytes: Buffer): Promise<LoadedPdf> {
  const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
  const numPages = doc.countPages();

  return {
    numPages,
    async renderPageToPng(pageNumber: number, scale = 1.6): Promise<Buffer> {
      // mupdf pages are 0-indexed; this module's callers use 1-indexed page numbers throughout.
      const page = doc.loadPage(pageNumber - 1);
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
      try {
        return Buffer.from(pixmap.asPNG());
      } finally {
        pixmap.destroy();
        page.destroy();
      }
    },
    async scanPageForBarcodes(pageNumber: number, scale = BARCODE_SCAN_SCALE): Promise<string[]> {
      const page = doc.loadPage(pageNumber - 1);
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceGray, false, true);
      try {
        const width = pixmap.getWidth();
        const height = pixmap.getHeight();
        const samples = pixmap.getPixels();
        // .buffer is the pixmap's *entire* backing WASM heap, not scoped to
        // this view -- must slice to the view's own byte range or zbar-wasm
        // rejects it with a width/height mismatch.
        const buf = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) as ArrayBuffer;
        const symbols = await scanGrayBuffer(buf, width, height);
        return symbols.map((s) => s.decode());
      } finally {
        pixmap.destroy();
        page.destroy();
      }
    },
  };
}
