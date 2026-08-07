import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

let cachedWasmDirUrl: string | null = null;

/**
 * These wasm/fallback-js files are vendored into this package's own source
 * tree (./vendor/pdfjs-wasm/, copied from pdfjs-dist/wasm/) rather than
 * resolved from node_modules at runtime. Two earlier approaches failed on
 * Netlify specifically:
 *  - `require.resolve("pdfjs-dist/wasm/jbig2.wasm")` as a literal string
 *    made webpack try to parse the binary .wasm file while building its
 *    module graph ("Module parse failed").
 *  - Obfuscating that same call from webpack's static analysis (so it
 *    stayed a real runtime require.resolve()) then failed at runtime with
 *    "Cannot find module" — Next's output-file-tracing guesses for the
 *    pnpm-layout-dependent node_modules/pdfjs-dist/wasm path didn't match
 *    what actually got deployed.
 * Vendoring avoids guessing entirely: the files are ordinary tracked
 * source, `outputFileTracingIncludes` in next.config.js points at their
 * exact monorepo-relative path, and Netlify's traced function bundle
 * preserves that same relative layout under its working directory (the
 * same pattern already relied on for Prisma's native query engine).
 */
function vendorWasmDirUrl(): string {
  if (cachedWasmDirUrl) return cachedWasmDirUrl;

  const relativePath = "packages/county-adapters/src/hidalgo/vendor/pdfjs-wasm";
  const candidates = [
    // Confirmed via a live Netlify invocation: process.cwd() there is
    // /var/task/apps/web, two levels below the traced-files root.
    join(process.cwd(), "../..", relativePath),
    join(process.cwd(), "..", relativePath),
    join(process.cwd(), relativePath),
    join(dirname(fileURLToPath(import.meta.url)), "vendor/pdfjs-wasm"),
  ];

  const found = candidates.find((dir) => existsSync(join(dir, "jbig2.wasm")));
  if (!found) {
    throw new Error(`Could not locate vendored pdfjs-dist wasm assets. Tried: ${candidates.join(", ")}`);
  }
  cachedWasmDirUrl = pathToFileURL(found + "/").href;
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
    wasmUrl: vendorWasmDirUrl(),
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
