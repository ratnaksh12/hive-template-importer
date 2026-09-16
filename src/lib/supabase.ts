import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client.
 *
 * This app ships without end-user auth, so all reads and writes happen in
 * server actions / route handlers using the service role key. That key must
 * never reach the browser — it is intentionally not NEXT_PUBLIC_.
 */
let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  // Hard guard: this client holds the service role key. If a module that uses it
  // is ever pulled into a client bundle, fail loudly instead of leaking the key.
  if (typeof window !== "undefined") {
    throw new Error(
      "getSupabaseAdmin() was called in the browser. Database access must stay " +
        "in server actions or route handlers.",
    );
  }

  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Supabase is not configured. Missing environment variable(s): ${missing.join(
        ", ",
      )}. Copy .env.example to .env.local and fill them in (see README.md).`,
    );
  }

  cached = createClient(url!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
