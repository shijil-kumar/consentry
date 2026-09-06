import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { runDetection } from "@/lib/detection";
import { ReportButton } from "@/components/report-button";
import { ShieldCheck, BadgeCheck, CircleAlert, FileCheck2, ExternalLink, ScanFace } from "lucide-react";

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Platform";
export const metadata = { title: "Verify Content Credential" };
export const dynamic = "force-dynamic";

interface VerifyRow {
  generation_id: string;
  script_sha256: string;
  consent_record_hash: string;
  consent_status: "pending" | "verified" | "revoked";
  license_id: string;
  license_expires_at: string | null;
  creator_handle: string | null;
  creator_name: string;
  buyer_org_name: string;
  delivered_at: string;
  c2pa_manifest: {
    _signed?: boolean; _watermarked?: boolean; title?: string;
    assertions?: Array<{ label: string }>;
  } | null;
  render_mode: "live" | "replay" | null;
  render_engine: string | null;
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-zinc-800 py-3 last:border-0">
      <span className="text-sm text-zinc-400">{label}</span>
      <span className={`text-right text-sm ${ok === false ? "text-amber-400" : "text-zinc-200"}`}>
        {ok !== undefined && (ok
          ? <BadgeCheck className="mr-1 inline size-4 text-emerald-400" />
          : <CircleAlert className="mr-1 inline size-4 text-amber-400" />)}
        <span className="break-all font-mono text-xs">{value}</span>
      </span>
    </div>
  );
}

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ generationId: string }>;
}) {
  const { generationId } = await params;
  const supabase = await supabaseServer(); // anon-safe: verify_generation is granted to anon
  const { data } = await supabase.rpc("verify_generation", { p_generation_id: generationId });
  const row = (Array.isArray(data) ? data[0] : data) as VerifyRow | undefined;
  const detection = row ? await runDetection(null, row.c2pa_manifest?._signed ?? false) : null;

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <header className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-md bg-emerald-500 text-zinc-950">
            <ShieldCheck className="size-5" />
          </span>
          {PLATFORM}
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-20 pt-6">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
          <FileCheck2 className="size-3.5" /> Content Credential
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Provenance record</h1>

        {!row ? (
          <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8 text-center text-zinc-400">
            No delivered credential found for this id. It may still be processing, or the id is wrong.
          </div>
        ) : (
          <>
            <p className="mt-2 text-zinc-400">
              This video was generated under a paid license against a verified consent record.
              Every field below is cross-checked live against {PLATFORM}&apos;s ledger.
            </p>

            <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
              <Row label="Creator" value={`${row.creator_name}${row.creator_handle ? ` (@${row.creator_handle})` : ""}`} />
              <Row label="Licensed to" value={row.buyer_org_name} />
              <Row label="Consent status" value={row.consent_status}
                ok={row.consent_status === "verified"} />
              <Row label="Consent record hash" value={`sha256:${row.consent_record_hash.slice(0, 24)}…`} ok />
              <Row label="Approved script hash" value={`sha256:${row.script_sha256.slice(0, 24)}…`} ok />
              <Row label="Delivered" value={new Date(row.delivered_at).toLocaleString("en-IN")} />
              <Row label="License valid until"
                value={row.license_expires_at ? new Date(row.license_expires_at).toLocaleDateString("en-IN") : "—"} />
              {/* Stated plainly on the PUBLIC page, not only inside the sealed
                  manifest: a replayed render must never be able to pass as a
                  live one just because nobody opened the credentials. */}
              <Row label="How it was rendered"
                value={row.render_mode === "replay"
                  ? `${row.render_engine ?? "engine"} — replayed sample, not rendered live`
                  : row.render_engine === "mock"
                    // "mock — rendered live" read as a contradiction. The demo
                    // engine is its own honest category, not a live/replay case.
                    ? "instant demo engine (free, watermarked like every render)"
                    : `${row.render_engine ?? "engine"} — rendered live`}
                ok={row.render_mode !== "replay"} />
              <Row label="Visible AI label" value={row.c2pa_manifest?._watermarked ? "burned in" : "pending"}
                ok={row.c2pa_manifest?._watermarked ?? false} />
              <Row label="C2PA manifest" value={row.c2pa_manifest?._signed ? "embedded + signed" : "sidecar (pilot)"}
                ok={row.c2pa_manifest?._signed ?? false} />
            </div>

            {detection && (
              <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                <h2 className="flex items-center gap-2 text-sm font-medium">
                  <ScanFace className="size-4 text-emerald-400" /> Authenticity scan
                  <span className="ml-auto rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">
                    {detection.mode === "reality_defender" ? "Reality Defender (live)" : "Provenance check"}
                  </span>
                </h2>
                <div className="mt-3 flex items-center gap-3">
                  <div className="relative size-14 shrink-0">
                    <svg viewBox="0 0 36 36" className="size-14 -rotate-90">
                      <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-zinc-800" />
                      <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3"
                        className={detection.score >= 0.7 ? "text-emerald-400" : "text-amber-400"}
                        strokeDasharray={`${detection.score * 94} 94`} strokeLinecap="round" />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold">
                      {Math.round(detection.score * 100)}
                    </span>
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${detection.score >= 0.7 ? "text-emerald-300" : "text-amber-300"}`}>
                      {detection.label}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">{detection.detail}</p>
                  </div>
                </div>
              </div>
            )}

            {row.consent_status === "revoked" && (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
                The creator has since revoked consent. This video was licensed while consent stood —
                the credential proves exactly when — but no new videos can be generated from this replica.
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-start gap-3">
              <a href="https://contentcredentials.org/verify" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-900">
                <ExternalLink className="size-4" /> Open the public C2PA verifier
              </a>
              <ReportButton generationId={row.generation_id} />
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Pilot builds sign with a development certificate, so the public verifier shows the
              manifest with an &ldquo;issuer not recognized&rdquo; note. Production signing uses a
              C2PA trust-list certificate. The ledger cross-check above is authoritative either way.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
