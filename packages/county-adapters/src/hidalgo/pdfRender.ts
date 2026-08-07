import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createCanvas, DOMMatrix, Path2D } from "@napi-rs/canvas";

/**
 * pdfjs-dist's Node build expects a few browser globals (DOMMatrix, Path2D)
 * that @napi-rs/canvas provides polyfills for. Also needs an explicit
 * wasmUrl (its default `wasmUrl: "wasm"` only resolves against a browser
 * `document.baseURI`, which doesn't exist in Node) pointing at its own
 * bundled wasm/ directory so the JBIG2/JPEG2000 decoders used by these
 * scanned county PDFs can load — verified against a real 739-page Hidalgo
 * bundle; without this fix pages render blank.
 */
if (!(globalThis as unknown as { DOMMatrix?: unknown }).DOMMatrix) {
  (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DOMMatrix;
}
if (!(globalThis as unknown as { Path2D?: unknown }).Path2D) {
  (globalThis as unknown as { Path2D: unknown }).Path2D = Path2D;
}

const nodeRequire = createRequire(import.meta.url);
let cachedWasmDirUrl: string | null = null;

function wasmDirUrl(): string {
  if (!cachedWasmDirUrl) {
    // Built from concatenated parts rather than a single string literal so
    // bundlers (Next.js/webpack in particular) don't statically recognize
    // this as `require.resolve("pdfjs-dist/wasm/jbig2.wasm")` and try to
    // parse the target .wasm file as a JS module while building the graph.
    // This must stay a real, unbundled Node require.resolve() at runtime
    // so it returns an actual filesystem path, not a bundler module id.
    const target = ["pdfjs-dist", "wasm", "jbig2" + ".wasm"].join("/");
    const jbig2WasmPath = nodeRequire.resolve(target);
    cachedWasmDirUrl = pathToFileURL(jbig2WasmPath.replace(/jbig2\.wasm$/, "")).href;
  }
  return cachedWasmDirUrl;
}

export interface LoadedPdf {
  numPages: number;
  renderPageToPng(pageNumber: number, scale?: number): Promise<Buffer>;
}

export async function loadPdf(pdfBytes: Buffer): Promise<LoadedPdf> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: true,
    wasmUrl: wasmDirUrl(),
  } as Parameters<typeof pdfjsLib.getDocument>[0]).promise;

  return {
    numPages: doc.numPages,
    async renderPageToPng(pageNumber: number, scale = 1.6): Promise<Buffer> {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      // @napi-rs/canvas's context/canvas are API-compatible with what pdf.js
      // expects from DOM Canvas/CanvasRenderingContext2D but aren't literally
      // those DOM types (this package has no "dom" lib), hence the casts.
      await page.render({
        canvas: null,
        canvasContext: ctx as unknown as Parameters<typeof page.render>[0]["canvasContext"],
        viewport,
      }).promise;
      return canvas.toBuffer("image/png");
    },
  };
}
