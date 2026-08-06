import { NextResponse } from "next/server";
import { resolveEntitlement } from "@foreclosuredata/auth/entitlement";
import { getCurrentProfileId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const profileId = await getCurrentProfileId();
  const entitlement = await resolveEntitlement(profileId);
  return NextResponse.json(entitlement);
}
