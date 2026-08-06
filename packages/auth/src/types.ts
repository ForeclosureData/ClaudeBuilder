export interface SupabaseSessionUser {
  id: string;
  email: string | null;
}

/** Minimal contract for a persistent session store, satisfied by both
 * `expo-secure-store` (mobile) and any RN-safe key/value implementation. */
export interface SecureStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
