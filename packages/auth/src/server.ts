import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Next.js App Router server-side Supabase client. Pass the cookie
 * get/set/remove functions from `next/headers` (in a Server Component,
 * `set`/`remove` are no-ops — that's fine, the middleware refreshes the
 * session on every request instead).
 */
export function createSupabaseServerClient(cookies: {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: CookieOptions): void;
  remove(name: string, options: CookieOptions): void;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).",
    );
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      get: (name: string) => cookies.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => cookies.set(name, value, options),
      remove: (name: string, options: CookieOptions) => cookies.remove(name, options),
    },
  });
}

/**
 * Service-role client for server-only privileged operations (webhooks,
 * admin actions that must bypass RLS deliberately). Never import this
 * from a client component or ship the key to the browser.
 */
export function createSupabaseServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL not configured.");
  }
  return createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
