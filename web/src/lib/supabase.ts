import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@core/database.types.ts";
import { requireEnv } from "./env";

export type Db = SupabaseClient<Database>;

/**
 * Mismo patrón que `_shared/db.ts::createDb` — service_role, sin sesión
 * propia (la sesión del panel es el JWT de `lib/auth/jwt.ts`, no la de
 * Supabase Auth, que este proyecto no usa).
 */
export function createDb(): Db {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
