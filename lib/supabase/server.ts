import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// JWT-bound server client for Server Components / Route Handlers (cookie auth).
// RLS is the authority — this client can only do what the signed-in user may do.
export async function supabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(URL, ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component — proxy.ts handles session refresh.
        }
      },
    },
  });
}

// JWT-bound client from a Bearer token (API routes called by tests/tools).
export function supabaseFromBearer(accessToken: string): SupabaseClient {
  return createClient(URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Resolve a JWT-bound client for a Route Handler: cookie session first,
// falling back to an Authorization: Bearer header.
export async function supabaseForRequest(req: Request): Promise<SupabaseClient> {
  const bearer = req.headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    return supabaseFromBearer(bearer.slice(7));
  }
  return supabaseServer();
}
