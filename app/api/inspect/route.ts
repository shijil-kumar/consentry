import { createHash } from "node:crypto";
import { readManifest } from "@/lib/media/pipeline";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

// Public "scan a video" endpoint: reads the C2PA manifest embedded in an
// uploaded file and cross-checks it against the ledger. No auth (it's a
// verification tool), but size-capped and lightly rate-limited.
const MAX_BYTES = 200 * 1024 * 1024;
const hits = new Map<string, { n: number; t: number }>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > 10;
}

interface LicenseAssertion {
  license_id?: string; request_id?: string; creator_handle?: string;
  buyer_org_name?: string; consent_record_hash?: string; consent_verified_at?: string;
  script_sha256?: string; license_expires_at?: string; verify_url?: string;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (throttled(ip)) return Response.json({ error: "rate_limited" }, { status: 429 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    file = form.get("file") as File | null;
  } catch {
    return Response.json({ error: "invalid_form" }, { status: 400 });
  }
  if (!file) return Response.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "file_too_large" }, { status: 413 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const read = await readManifest(bytes);

  // Two independent ways to identify a file, deliberately kept distinct:
  //
  //   A. Content Credentials — read the signed C2PA manifest out of the file.
  //      Strongest: it survives copying and renaming, and names its signer.
  //   B. Exact-bytes fingerprint — sha256 against the ledger. Matches only an
  //      unmodified copy and proves nothing cryptographic, but it identifies
  //      files that were delivered before signing was working.
  //
  // Fall through A -> B, and never report a hash match as though a signature had
  // been verified — the UI labels the two verdicts differently on purpose.
  if (!read.ok) {
    const byHash = await lookupByHash(sha256);
    if (byHash) {
      return Response.json({
        ok: true,
        credentialed: false,
        method: "file_hash",
        verdict: byHash.ledger.revoked ? "revoked" : "ledger_match",
        generation_id: byHash.generationId,
        assertion: byHash.assertion,
        ledger: byHash.ledger,
        sha256,
        detail:
          "Matched by exact file fingerprint: these bytes are a delivery from our ledger, " +
          "so the licence, consent and approval below are the real record for this video. " +
          "Cryptographic Content Credentials are read in the self-hosted demo — this host " +
          "cannot run the C2PA reader.",
      });
    }
    if (read.error === "c2pa_unavailable") {
      return Response.json({
        ok: true, credentialed: false, sha256,
        detail: "The credential reader is unavailable on this host right now, and this file is not a delivery from our ledger either. Try again shortly.",
      });
    }
    return Response.json({
      ok: true,
      credentialed: false,
      sha256,
      detail: "No Content Credentials found in this file. It was not produced (or has been stripped) by a provenance-signing pipeline.",
    });
  }

  // ── INTEGRITY GATE ──────────────────────────────────────────────────────
  // Before reading a single claim out of the manifest, ask whether the manifest
  // still matches the bytes. A C2PA manifest is a signed statement ABOUT some
  // content; if the content changed, every claim inside it is void. Skipping
  // this check meant a genuine endorsement could be re-cut — new words in the
  // star's mouth — and this endpoint would still answer "verified", citing the
  // real creator, the real licence and the real consent record. That is the
  // exact attack the product exists to prevent.
  if (read.validation?.contentAltered) {
    return Response.json({
      ok: true,
      credentialed: true,
      platform_signed: true,
      method: "content_credentials",
      verdict: "tampered",
      sha256,
      validation: read.validation,
      detail:
        "This file carries our Content Credentials, but the video no longer matches " +
        "what was signed — it has been modified since delivery. Nothing inside the " +
        "credential can be trusted: treat this as an altered copy, not an approved video.",
    });
  }

  // Pull our license assertion out of the active manifest
  const m = read.manifest as {
    active_manifest?: string;
    manifests?: Record<string, { assertions?: Array<{ label: string; data: unknown }>; signature_info?: { issuer?: string } }>;
  };
  const active = m.active_manifest ? m.manifests?.[m.active_manifest] : undefined;
  const lic = active?.assertions?.find((a) => a.label === "com.consentfirst.license")?.data as LicenseAssertion | undefined;
  if (!lic) {
    return Response.json({
      ok: true, credentialed: true, platform_signed: false,
      detail: "The file carries Content Credentials, but not from this platform.",
      issuer: active?.signature_info?.issuer ?? null,
    });
  }

  // Ledger cross-check
  const generationId = lic.verify_url?.match(/\/verify\/([0-9a-f-]{36})/i)?.[1] ?? null;
  const ledger = generationId ? await ledgerFor(generationId) : { found: false };

  return Response.json({
    ok: true,
    credentialed: true,
    platform_signed: true,
    method: "content_credentials",
    assertion: lic,
    generation_id: generationId,
    ledger,
    sha256,
    verdict: ledger.found
      ? (ledger.revoked ? "revoked" : "verified")
      : "unknown_to_ledger",
  });
}

interface Ledger {
  found: boolean; generation_status?: string; license_status?: string;
  consent_status?: string; revoked?: boolean;
}

// Walk generation -> licence -> listing -> avatar -> consent record. Deliberately
// re-read live rather than trusting anything embedded in the file: a revoked
// consent must flip the verdict even for a file signed while it was still valid.
async function ledgerFor(generationId: string): Promise<Ledger> {
  const admin = supabaseAdmin();
  const { data: gen } = await admin.from("generations")
    .select("id, status, license_id").eq("id", generationId).maybeSingle();
  if (!gen) return { found: false };
  const { data: licRow } = await admin.from("licenses")
    .select("status, listing_id").eq("id", gen.license_id).maybeSingle();
  let consentStatus: string | undefined;
  if (licRow) {
    const { data: listing } = await admin.from("listings")
      .select("avatar_id").eq("id", licRow.listing_id).maybeSingle();
    if (listing) {
      const { data: av } = await admin.from("avatars")
        .select("consent_record_id").eq("id", listing.avatar_id).maybeSingle();
      if (av) {
        const { data: consent } = await admin.from("consent_records")
          .select("status").eq("id", av.consent_record_id).maybeSingle();
        consentStatus = consent?.status;
      }
    }
  }
  return {
    found: true,
    generation_status: gen.status,
    license_status: licRow?.status,
    consent_status: consentStatus,
    revoked: consentStatus === "revoked",
  };
}

// Fallback identification when the C2PA reader is unavailable: exact bytes.
// The licence details come from the manifest we stored at delivery time, so the
// answer is as detailed as the signed path — just established differently.
async function lookupByHash(sha256: string): Promise<
  { generationId: string; assertion: LicenseAssertion; ledger: Ledger } | null
> {
  const admin = supabaseAdmin();
  const { data: gen } = await admin.from("generations")
    .select("id, c2pa_manifest").eq("output_sha256", sha256).maybeSingle();
  if (!gen) return null;
  const manifest = gen.c2pa_manifest as {
    assertions?: Array<{ label: string; data: unknown }>;
  } | null;
  const assertion = (manifest?.assertions?.find((a) => a.label === "com.consentfirst.license")
    ?.data ?? {}) as LicenseAssertion;
  return { generationId: gen.id, assertion, ledger: await ledgerFor(gen.id) };
}
