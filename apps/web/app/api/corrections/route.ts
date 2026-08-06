import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { correctionReportSchema } from "@foreclosuredata/validation";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const ip = clientIpFrom(request);
  if (!checkRateLimit(`correction:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = correctionReportSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const profileId = await getCurrentProfileId();

  await prisma.correctionReport.create({
    data: {
      profileId,
      propertyId: parsed.data.propertyId,
      foreclosureCaseId: parsed.data.foreclosureCaseId,
      fieldName: parsed.data.fieldName,
      description: parsed.data.description,
    },
  });

  return NextResponse.json({ ok: true });
}
