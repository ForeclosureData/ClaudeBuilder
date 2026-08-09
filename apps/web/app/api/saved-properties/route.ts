import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { resolveEntitlement } from "@foreclosuredata/auth/entitlement";
import { savePropertySchema } from "@foreclosuredata/validation";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";
import { PUBLICATION_EXTRA_INCLUDE, isPubliclyVisible } from "@/lib/publicationVisibility";

export async function POST(request: Request) {
  const profileId = await getCurrentProfileId();
  if (!profileId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  if (!checkRateLimit(`save:${profileId}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = savePropertySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const entitlement = await resolveEntitlement(profileId);
  const existingCount = await prisma.savedProperty.count({ where: { profileId } });
  if (existingCount >= entitlement.maxSavedProperties) {
    return NextResponse.json(
      { error: `Your plan allows up to ${entitlement.maxSavedProperties} saved properties. Upgrade to save more.` },
      { status: 403 },
    );
  }

  await prisma.savedProperty.upsert({
    where: { profileId_propertyId: { profileId, propertyId: parsed.data.propertyId } },
    update: { notes: parsed.data.notes },
    create: { profileId, propertyId: parsed.data.propertyId, notes: parsed.data.notes },
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const profileId = await getCurrentProfileId();
  if (!profileId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const saved = await prisma.savedProperty.findMany({
    where: { profileId },
    include: {
      property: {
        include: {
          county: true,
          foreclosureCases: { where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 1, include: { borrower: true, sales: true, ...PUBLICATION_EXTRA_INCLUDE } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  // A property saved earlier can later be found to have a conflict/duplicate
  // -- still return the row (the user's save action itself is real and
  // shouldn't silently vanish) but flag it rather than presenting it as an
  // ordinary clean listing.
  const items = saved.map((s) => {
    const fc = s.property.foreclosureCases[0];
    return { ...s, isPubliclyVisible: fc ? isPubliclyVisible({ ...fc, property: s.property }) : false };
  });
  return NextResponse.json({ items });
}
