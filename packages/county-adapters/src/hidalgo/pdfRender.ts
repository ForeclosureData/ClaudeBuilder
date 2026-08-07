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
 */
import * as mupdf from "mupdf";

export interface LoadedPdf {
  numPages: number;
  renderPageToPng(pageNumber: number, scale?: number): Promise<Buffer>;
}

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
  };
}
