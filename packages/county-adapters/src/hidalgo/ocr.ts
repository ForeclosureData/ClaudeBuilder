/**
 * Local OCR (no AI, no network) via tesseract.js, an official WASM build of
 * the Tesseract engine. Configured to run fully offline: the bundled
 * English trained-data file (./assets/eng.traineddata) is read directly
 * from disk rather than fetched from a CDN, so a cold start never needs
 * network access to do OCR.
 *
 * NOT wired into the Netlify serverless deploy -- see splitBundle.ts and
 * the ingestion status report for why. In short: unlike mupdf/zbar-wasm
 * (a single self-contained WASM file each), tesseract.js's Node worker
 * spawns a real worker_thread from a file path computed via its own
 * __dirname at runtime, and its Core loader dynamically `require()`s one
 * of several WASM variants based on a CPU feature probe done at runtime --
 * so nothing short of tracing tesseract.js's *entire* source tree plus all
 * of tesseract.js-core (~44MB, four WASM variants, only one of which is
 * actually used depending on the deployed CPU) would make it resolvable in
 * a packaged Lambda bundle. That's the exact "scattered fallback/worker
 * files" failure pattern that made pdfjs-dist unreliable in Lambda earlier
 * in this project, at a larger unpacked size. Runs correctly here as a
 * long-lived local/worker process instead.
 */
import { createWorker, OEM, type Worker } from "tesseract.js";
import path from "node:path";

const ASSETS_DIR = path.join(__dirname, "..", "..", "assets");

export interface OcrResult {
  text: string;
  /** Tesseract's own page-level confidence, 0-100. */
  confidence: number;
}

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng", OEM.LSTM_ONLY, {
      langPath: ASSETS_DIR,
      cachePath: ASSETS_DIR,
      gzip: false,
    });
  }
  return workerPromise;
}

export async function ocrPng(pngBuffer: Buffer): Promise<OcrResult> {
  const worker = await getWorker();
  const {
    data: { text, confidence },
  } = await worker.recognize(pngBuffer);
  return { text, confidence };
}

/** Runs OCR over multiple pages sequentially (tesseract.js workers process one job at a time) and concatenates the text, page-separated. Confidence is the average across pages. */
export async function ocrPages(pngBuffers: Buffer[]): Promise<OcrResult> {
  if (pngBuffers.length === 0) return { text: "", confidence: 0 };

  const results: OcrResult[] = [];
  for (const png of pngBuffers) {
    results.push(await ocrPng(png));
  }

  return {
    text: results.map((r) => r.text).join("\n\n"),
    confidence: results.reduce((sum, r) => sum + r.confidence, 0) / results.length,
  };
}

export async function shutdownOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  const pending = workerPromise;
  workerPromise = null;
  const worker = await pending;
  await worker.terminate();
}
