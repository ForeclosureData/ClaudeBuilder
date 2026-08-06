import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@foreclosuredata/auth/server";

/** Call once per request (Server Component, Route Handler, or Server Action). */
export function getSupabaseServerClient() {
  const cookieStore = cookies();
  return createSupabaseServerClient({
    get: (name) => cookieStore.get(name),
    set: (name, value, options) => {
      try {
        cookieStore.set(name, value, options);
      } catch {
        // Called from a Server Component render — middleware refreshes the session instead.
      }
    },
    remove: (name, options) => {
      try {
        cookieStore.set(name, "", { ...options, maxAge: 0 });
      } catch {
        // See above.
      }
    },
  });
}

/**
 * Returns the current session's profile id, or null if signed out OR if
 * Supabase isn't configured (e.g. running this demo without a real
 * Supabase project) — callers should treat both cases as "not signed in"
 * rather than crashing the page.
 */
export async function getCurrentProfileId(): Promise<string | null> {
  try {
    const supabase = getSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
