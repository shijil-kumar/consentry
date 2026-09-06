"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Browser client — publishable key + user JWT, cookie-based session storage so
// Server Components / Route Handlers see the same session (@supabase/ssr).
// ALL user-driven reads/writes go through this client: RLS is the authority.
let browserClient: SupabaseClient | undefined;

export function supabaseBrowser(): SupabaseClient {
  browserClient ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return browserClient;
}
