import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { SecureStorageAdapter } from "./types";

/**
 * Mobile Supabase client factory. `apps/mobile` supplies a storage adapter
 * backed by `expo-secure-store` so the session persists securely across
 * app restarts — this package stays free of any React Native dependency.
 */
export function createSupabaseMobileClient(config: {
  url: string;
  anonKey: string;
  storage: SecureStorageAdapter;
}) {
  return createClient<Database>(config.url, config.anonKey, {
    auth: {
      storage: config.storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}
