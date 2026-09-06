import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ⚠ SERVICE-ROLE CLIENT — bypasses RLS. The service role is a courier, not an
// authority: every privileged state transition still goes through the
// SECURITY DEFINER RPCs, which re-validate their own preconditions in Postgres.
//
// Import allowlist (enforced by ESLint `no-restricted-imports` in
// eslint.config.mjs — keep this list in sync with that file):
//   app/api/webhooks/**   (Razorpay HMAC-verified, Tavus token+refetch)
//   app/api/jobs/**       (generation/replica workers, media pipeline, sweeps)
//   app/api/assets/**     (signed URLs AFTER an RLS-checked party read)
//   app/api/auth/**       (signup: create a confirmed user)
//   app/api/requests/**   (record the engine verdict — computed from DB truths)
//   app/api/checkout/**   (create order + stamp order_id)
//   app/api/payments/**   (mock webhook stand-in; real activation re-validated in the RPC)
//   app/api/dev/**        (DEV_OPEN-gated frictionless login)
//   scripts/** and tests/** (seeding/fixtures only)
// Every one of these still routes privileged writes through SECURITY DEFINER
// RPCs that re-validate in Postgres. Never import from pages or components.

if (typeof window !== "undefined") {
  throw new Error("lib/supabase/admin.ts must never be bundled for the browser");
}

let adminClient: SupabaseClient | undefined;

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error("Supabase admin env vars missing");
  adminClient ??= createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return adminClient;
}
