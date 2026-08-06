import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { notificationPreferencesSchema } from "@foreclosuredata/validation";
import { getCurrentProfileId } from "@/lib/supabase/server";

export async function GET() {
  const profileId = await getCurrentProfileId();
  if (!profileId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const prefs = await prisma.notificationPreference.upsert({
    where: { profileId },
    update: {},
    create: { profileId },
  });
  return NextResponse.json({
    emailEnabled: prefs.emailEnabled,
    webPushEnabled: prefs.webPushEnabled,
    expoPushEnabled: prefs.expoPushEnabled,
    eventTypesEnabled: prefs.eventTypesEnabled,
  });
}

export async function PUT(request: Request) {
  const profileId = await getCurrentProfileId();
  if (!profileId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = notificationPreferencesSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const updated = await prisma.notificationPreference.upsert({
    where: { profileId },
    update: parsed.data,
    create: { profileId, ...parsed.data },
  });
  return NextResponse.json({
    emailEnabled: updated.emailEnabled,
    webPushEnabled: updated.webPushEnabled,
    expoPushEnabled: updated.expoPushEnabled,
    eventTypesEnabled: updated.eventTypesEnabled,
  });
}
