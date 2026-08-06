import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@foreclosuredata/database";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";

const countyRequestSchema = z.object({
  requestedCountyName: z.string().min(2).max(100),
  state: z.string().min(2).max(2).default("TX"),
  requesterEmail: z.string().email().optional(),
  notes: z.string().max(500).optional(),
});

/** Public demand signal for the county-expansion roadmap — no account required. */
export async function POST(request: Request) {
  const ip = clientIpFrom(request);
  if (!checkRateLimit(`county-request:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = countyRequestSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  await prisma.countyRequest.create({ data: parsed.data });
  return NextResponse.json({ ok: true });
}
