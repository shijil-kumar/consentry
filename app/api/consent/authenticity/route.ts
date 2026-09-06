import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseForRequest } from "@/lib/supabase/server";
import { extractFrame } from "@/lib/media/pipeline";
import { detectImage } from "@/lib/reality-defender";

export const maxDuration = 120; // RD polls the analysis result

// On-demand: verify the CONSENT footage is a real human via Reality Defender.
// The caller must own the consent record (RLS-checked read on the caller's JWT);
// the service client only downloads the private video + stores the result.
const Body = z.object({ consent_id: z.string().uuid() });

export async function POST(req: Request) {
  const supabase = await supabaseForRequest(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch { return Response.json({ error: "invalid_body" }, { status: 400 }); }

  // RLS: caller can only read their own org's consent rows
  const { data: consent } = await supabase
    .from("consent_records").select("id, consent_video_path, creator_id")
    .eq("id", body.consent_id).maybeSingle();
  if (!consent || consent.creator_id !== user.id) {
    return Response.json({ error: "not_found_or_forbidden" }, { status: 404 });
  }
  if (!process.env.REALITY_DEFENDER_API_KEY) {
    return Response.json({ error: "detector_not_configured" }, { status: 503 });
  }

  const admin = supabaseAdmin();
  const { data: file, error: dlErr } = await admin.storage.from("consent-videos").download(consent.consent_video_path);
  if (dlErr || !file) return Response.json({ error: "video_unavailable" }, { status: 400 });
  const videoBytes = Buffer.from(await file.arrayBuffer());

  const frame = await extractFrame(videoBytes, 1);
  if (!frame) return Response.json({ error: "frame_extract_failed" }, { status: 500 });

  const result = await detectImage(frame);
  await admin.rpc("set_consent_authenticity", {
    p_consent_id: body.consent_id,
    p_result: { ...result, checked_at: new Date().toISOString() },
  });
  return Response.json({ ok: true, result });
}
