import { supabaseForRequest } from "@/lib/supabase/server";
import { buildConsentScript, issueChallenge, CONSENT_SCRIPT_VERSION } from "@/lib/consent";

// Issues a fresh voice-captcha challenge + the personalized consent script.
// Stateless: the challenge is HMAC-signed and verified again at submit time.
export async function GET(req: Request) {
  const supabase = await supabaseForRequest(req);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, role")
    .eq("id", user.id)
    .single();
  if (!profile) return Response.json({ error: "no_profile" }, { status: 403 });
  if (profile.role !== "creator") {
    return Response.json({ error: "creators_only" }, { status: 403 });
  }

  const challenge = issueChallenge(user.id);
  return Response.json({
    challenge,
    script_version: CONSENT_SCRIPT_VERSION,
    script: buildConsentScript(profile.display_name, new Date().toISOString(), challenge.phrase),
  });
}
