import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client.
 *
 * This app ships without end-user auth, so all reads and writes happen in
 * server actions / route handlers using the secret (service role) key. That key
 * must never reach the browser — it is intentionally not NEXT_PUBLIC_.
 */
let cached: SupabaseClient | null = null;

/**
 * Supabase renamed its API keys: `service_role` -> "secret" (`sb_secret_…`) and
 * `anon` -> "publishable" (`sb_publishable_…`). Accept either variable name so
 * both the legacy and current dashboards are easy to copy from.
 */
const SECRET_KEY_VARS = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

function readSecretKey(): string | undefined {
  for (const name of SECRET_KEY_VARS) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function getSupabaseAdmin(): SupabaseClient {
  // Hard guard: this client holds the secret key. If a module that uses it is
  // ever pulled into a client bundle, fail loudly instead of leaking the key.
  if (typeof window !== "undefined") {
    throw new Error(
      "getSupabaseAdmin() was called in the browser. Database access must stay " +
        "in server actions or route handlers.",
    );
  }

  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = readSecretKey();

  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !secretKey && "SUPABASE_SECRET_KEY",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Supabase is not configured. Missing environment variable(s): ${missing.join(
        ", ",
      )}. Copy .env.example to .env.local and fill them in (see README.md).`,
    );
  }

  // A publishable/anon key is RLS-constrained. Every table here has RLS enabled
  // with no permissive policies, so such a key would silently return empty
  // results and reject every write. Fail immediately with a useful message
  // instead of letting that look like an empty database.
  if (secretKey!.startsWith("sb_publishable_")) {
    throw new Error(
      "A publishable (anon) Supabase key was supplied where the secret key is " +
        "required. Row Level Security is enabled with no permissive policies, so " +
        "a publishable key cannot read or write any row. Use the secret key " +
        "(sb_secret_…) from Project Settings -> API Keys.",
    );
  }

  cached = createClient(url!, secretKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export function isSupabaseConfigured(): boolean {
  const key = readSecretKey();
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      key &&
      !key.startsWith("sb_publishable_"),
  );
}
