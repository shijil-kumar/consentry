import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phone side of the desktop->phone consent handoff (QR).
//
// This is a ROUTE HANDLER, not a page, on purpose: Next.js only permits writing
// cookies from route handlers and server actions, so doing the session exchange
// during a Server Component render silently failed to persist the session and
// bounced the phone to /login.
//
// It exchanges the single-use handoff token for a REAL Supabase session for that
// creator, so every downstream check — storage RLS on consent-videos, the signed
// challenge, submit_consent()'s role check — still applies exactly as on desktop.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  // Resolve against the REQUEST url, not APP_BASE_URL: the phone must come back
  // to the exact host it scanned. (APP_BASE_URL can legitimately differ from the
  // serving origin — e.g. a local server on a non-default port.)
  const to = (path: string) =>
    Response.redirect(new URL(path, req.url).toString(), 303);
  const bounce = (reason: string) => to(`/consent/phone/expired?reason=${reason}`);

  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("consent_handoff_tokens")
    .select("token, creator_id, expires_at, used_at")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!row) return bounce("expired");
  if (row.used_at) return bounce("used");

  // burn before issuing — one scan is worth exactly one session
  await admin.from("consent_handoff_tokens")
    .update({ used_at: new Date().toISOString() }).eq("token", token);

  const { data: userRes } = await admin.auth.admin.getUserById(row.creator_id);
  const email = userRes?.user?.email;
  if (!email) return bounce("expired");

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink", email,
  });
  const hashedToken = link?.properties?.hashed_token;
  if (linkErr || !hashedToken) return bounce("expired");

  const supabase = await supabaseServer(); // cookie-writing SSR client
  const { error: otpErr } = await supabase.auth.verifyOtp({
    type: "magiclink", token_hash: hashedToken,
  });
  if (otpErr) return bounce("expired");

  return to("/creator/consent?from=phone");
}
