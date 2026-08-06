import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { getCurrentProfileId } from "@/lib/supabase/server";

export async function DELETE(_request: Request, { params }: { params: { propertyId: string } }) {
  const profileId = await getCurrentProfileId();
  if (!profileId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  await prisma.savedProperty.deleteMany({ where: { profileId, propertyId: params.propertyId } });
  return NextResponse.json({ ok: true });
}
