import { supabaseAdmin } from "@/lib/supabase/admin";

// Compliance API v1 — public, read-only verification of a delivered video.
// The same facts as the human /verify page, as JSON, for platforms/agencies
// that want to check provenance programmatically ("compliance as an API").
// Only public-safe fields are exposed; rate-limited per IP.
const hits = new Map<string, { n: number; t: number }>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > 30;
}

export async function GET(req: Request, ctx: { params: Promise<{ generationId: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (throttled(ip)) return Response.json({ error: "rate_limited" }, { status: 429 });

  const { generationId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(generationId)) {
    return Response.json({ error: "invalid_id" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: gen } = await admin.from("generations")
    .select("id, status, created_at, license_id, c2pa_manifest")
    .eq("id", generationId).maybeSingle();
  if (!gen) return Response.json({ verified: false, reason: "unknown_generation" }, { status: 404 });

  const { data: lic } = await admin.from("licenses")
    .select("status, expires_at, listing_id").eq("id", gen.license_id).maybeSingle();
  let consentStatus: string | null = null;
  let creatorHandle: string | null = null;
  if (lic) {
    const { data: listing } = await admin.from("listings")
      .select("avatar_id, creator_id").eq("id", lic.listing_id).maybeSingle();
    if (listing) {
      const [{ data: av }, { data: prof }] = await Promise.all([
        admin.from("avatars").select("consent_record_id").eq("id", listing.avatar_id).maybeSingle(),
        admin.from("profiles").select("handle").eq("id", listing.creator_id).maybeSingle(),
      ]);
      creatorHandle = prof?.handle ?? null;
      if (av) {
        const { data: consent } = await admin.from("consent_records")
          .select("status").eq("id", av.consent_record_id).maybeSingle();
        consentStatus = consent?.status ?? null;
      }
    }
  }

  const manifest = gen.c2pa_manifest as { _signed?: boolean; watermarked?: boolean } | null;
  const revoked = consentStatus === "revoked";
  return Response.json({
    api_version: "v1",
    generation_id: gen.id,
    verified: gen.status === "delivered" && !revoked,
    delivered: gen.status === "delivered",
    consent_status: consentStatus,
    consent_revoked: revoked,
    license_status: lic?.status ?? null,
    license_expires_at: lic?.expires_at ?? null,
    creator_handle: creatorHandle,
    provenance_signed: manifest?._signed ?? false,
    visibly_labelled: manifest?.watermarked ?? false,
    checked_at: new Date().toISOString(),
    human_page: `/verify/${gen.id}`,
  });
}
