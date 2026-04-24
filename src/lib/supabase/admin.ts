import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client with the Supabase service role key.
 * Use ONLY for admin operations: inviteUserByEmail, deleteUser, updateUserById, listUsers.
 * Never import this file from a "use client" component.
 */
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
