import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseForRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 15;

// Desktop -> phone handoff for consent recording. The celebrity's laptop webcam
// is usually the worst camera they own; their phone is the best. This mints a
// short-lived, single-use token, returns it as a QR (SVG, inlined — no external
// image host) plus a copyable link, exactly like HeyGen's "Record via phone".
//
// Security: same shape as approval_tokens — the token IS the credential, so it
// is only ever returned to the authenticated creator who asked for it, it is
// service-only in the DB, it expires, and it is burned on use.
const TTL_MINUTES = 20;

export async function POST(req: Request) {
  const supabase = await supabaseForRequest(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("id, role, org_id").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "creator") {
    return Response.json({ error: "creators_only" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  // one live handoff at a time — scanning an older QR should fail closed
  await admin.from("consent_handoff_tokens")
    .delete().eq("creator_id", profile.id).is("used_at", null);

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000);
  const { error } = await admin.from("consent_handoff_tokens").insert({
    token, creator_id: profile.id, org_id: profile.org_id,
    expires_at: expiresAt.toISOString(),
  });
  if (error) return Response.json({ error: "could_not_create_link" }, { status: 500 });

  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  const url = `${base}/consent/phone/${token}`;
  // data-URI PNG, not raw SVG: the client renders it in a plain <img>, so no
  // markup from this route is ever injected into the page.
  const qrDataUrl = await QRCode.toDataURL(url, {
    margin: 1, width: 220,
    color: { dark: "#0A0F12", light: "#FFFFFF" },
  });

  return Response.json({ ok: true, url, qr_png: qrDataUrl, expires_at: expiresAt.toISOString() });
}
