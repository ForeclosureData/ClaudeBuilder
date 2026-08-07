import { NextResponse } from "next/server";
import { hidalgoAdapter } from "@foreclosuredata/county-adapters";
import { loadPdf } from "@foreclosuredata/county-adapters/src/hidalgo/pdfRender";

export const maxDuration = 60;

/**
 * TEMPORARY — renders page 1 of the current Hidalgo bundle in the
 * deployed runtime and returns it as a real PNG image, to visually
 * confirm what Claude vision is actually being sent (it's classifying
 * page 1 as "not a cover sheet", contradicting a manual sandbox render
 * of the same page). Removed/neutered immediately after use.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");

  const discovered = await hidalgoAdapter.discoverNotices({});
  const notice = discovered[0];
  if (!notice) return NextResponse.json({ error: "No bundle discovered" }, { status: 404 });

  const downloaded = await hidalgoAdapter.downloadNotice(notice);
  const pdf = await loadPdf(downloaded.fileBuffer);
  const png = await pdf.renderPageToPng(page, 1.6);

  return new NextResponse(new Uint8Array(png), { headers: { "content-type": "image/png" } });
}
