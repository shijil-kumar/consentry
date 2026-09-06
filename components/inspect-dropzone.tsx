"use client";

import { useRef, useState } from "react";
import { UploadCloud, Loader2, BadgeCheck, ShieldAlert, FileQuestion, ExternalLink } from "lucide-react";

interface InspectResult {
  ok: boolean;
  credentialed: boolean;
  platform_signed?: boolean;
  detail?: string;
  issuer?: string | null;
  assertion?: {
    creator_handle?: string; buyer_org_name?: string; consent_verified_at?: string;
    script_sha256?: string; license_expires_at?: string; verify_url?: string;
  };
  generation_id?: string | null;
  ledger?: { found: boolean; generation_status?: string; license_status?: string; consent_status?: string; revoked?: boolean };
  verdict?: "verified" | "revoked" | "unknown_to_ledger" | "ledger_match" | "tampered";
  /** Present on a tampered verdict: which C2PA integrity assertions failed. */
  validation?: { state: string | null; contentAltered: boolean; failureCodes: string[] };
  // How the file was identified. "content_credentials" = the signed C2PA
  // manifest was read out of the file. "file_hash" = the bytes matched a
  // delivery in the ledger. The second is a weaker claim and must not be
  // presented as a signature check.
  method?: "content_credentials" | "file_hash";
  sha256?: string;
}

export function InspectDropzone() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<InspectResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function scan(file: File) {
    setBusy(true); setError(null); setResult(null); setFileName(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/inspect", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "scan failed");
      setResult(j);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) scan(f); }}
        className={`flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 transition-colors ${drag ? "border-emerald-400 bg-emerald-500/10" : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-500"}`}
      >
        {busy ? <Loader2 className="size-8 animate-spin text-emerald-400" /> : <UploadCloud className="size-8 text-zinc-500" />}
        <span className="text-sm text-zinc-300">
          {busy ? `Reading credentials in ${fileName}…` : "Drop a video here, or click to choose"}
        </span>
        <span className="text-xs text-zinc-600">MP4 · up to 200 MB · nothing is stored</span>
      </button>
      <input ref={inputRef} type="file" accept="video/mp4,video/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) scan(f); e.target.value = ""; }} />

      <button type="button" disabled={busy}
        onClick={async () => {
          const r = await fetch("/sample-verified.mp4");
          scan(new File([await r.blob()], "sample-verified.mp4", { type: "video/mp4" }));
        }}
        className="mt-3 text-sm font-medium text-emerald-400 hover:text-emerald-300 disabled:opacity-50">
        No video handy? Scan our sample →
      </button>

      {error && <p className="mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}

      {result && (
        <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          {result.method === "file_hash" ? (
            <div>
              <div className="flex items-start gap-3">
                {result.verdict === "revoked"
                  ? <ShieldAlert className="mt-0.5 size-6 shrink-0 text-red-400" />
                  : <BadgeCheck className="mt-0.5 size-6 shrink-0 text-emerald-400" />}
                <div>
                  <p className="font-medium text-zinc-100">
                    {result.verdict === "revoked"
                      ? "Consent has been REVOKED for this replica"
                      : "Match — this exact file is a licensed delivery"}
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    Identified by its file fingerprint against the live ledger, so everything
                    below is the real record for this video.
                  </p>
                </div>
              </div>
              <Details result={result} />
              <p className="mt-4 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
                Matched on exact bytes — a re-encoded copy would not match here. Reading the
                signed Content Credentials out of the file itself runs in the self-hosted demo.
              </p>
            </div>
          ) : !result.credentialed ? (
            <div className="flex items-start gap-3">
              <FileQuestion className="mt-0.5 size-6 shrink-0 text-zinc-500" />
              <div>
                <p className="font-medium text-zinc-200">No Content Credentials</p>
                <p className="mt-1 text-sm text-zinc-400">{result.detail}</p>
              </div>
            </div>
          ) : !result.platform_signed ? (
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-6 shrink-0 text-amber-400" />
              <div>
                <p className="font-medium text-zinc-200">Credentials from another issuer</p>
                <p className="mt-1 text-sm text-zinc-400">{result.detail}{result.issuer ? ` Issuer: ${result.issuer}` : ""}</p>
              </div>
            </div>
          ) : result.verdict === "tampered" ? (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 size-6 shrink-0 text-red-400" />
                <div>
                  <p className="text-base font-semibold text-red-300">
                    Altered since delivery — do not trust this video
                  </p>
                  <p className="mt-1 text-sm text-zinc-300">{result.detail}</p>
                  {result.validation?.failureCodes?.length ? (
                    <p className="mt-2 font-mono text-xs text-red-300/80">
                      {result.validation.failureCodes.join(" · ")}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-start gap-3">
                {result.verdict === "revoked"
                  ? <ShieldAlert className="mt-0.5 size-6 shrink-0 text-red-400" />
                  : <BadgeCheck className="mt-0.5 size-6 shrink-0 text-emerald-400" />}
                <div>
                  <p className="font-medium text-zinc-100">
                    {result.verdict === "verified" && "Verified — a consented, licensed synthetic"}
                    {result.verdict === "revoked" && "Consent has been REVOKED for this replica"}
                    {result.verdict === "unknown_to_ledger" && "Signed by this platform, but not found in the ledger"}
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    Credentials read from inside the file and cross-checked against the live ledger.
                  </p>
                </div>
              </div>
              <Details result={result} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Shared by both identification paths (signed credentials and file fingerprint):
// once we know WHICH delivery this is, the record shown is identical.
function Details({ result }: { result: InspectResult }) {
  return (
    <>
      <dl className="mt-5 grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
        {result.assertion?.creator_handle && (
          <div><dt className="text-zinc-500">Creator</dt><dd className="text-zinc-200">@{result.assertion.creator_handle}</dd></div>
        )}
        {result.assertion?.buyer_org_name && (
          <div><dt className="text-zinc-500">Licensed by</dt><dd className="text-zinc-200">{result.assertion.buyer_org_name}</dd></div>
        )}
        {result.assertion?.consent_verified_at && (
          <div><dt className="text-zinc-500">Consent verified</dt><dd className="text-zinc-200">{new Date(result.assertion.consent_verified_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</dd></div>
        )}
        {result.assertion?.license_expires_at && (
          <div><dt className="text-zinc-500">License valid until</dt><dd className="text-zinc-200">{new Date(result.assertion.license_expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</dd></div>
        )}
        {result.ledger?.found && (
          <>
            <div><dt className="text-zinc-500">Ledger status</dt><dd className="capitalize text-zinc-200">{result.ledger.generation_status} · license {result.ledger.license_status}</dd></div>
            <div><dt className="text-zinc-500">Consent status</dt>
              <dd className={result.ledger.revoked ? "font-medium text-red-400" : "text-emerald-400"}>{result.ledger.consent_status}</dd></div>
          </>
        )}
        {result.assertion?.script_sha256 && (
          <div className="sm:col-span-2"><dt className="text-zinc-500">Approved script hash</dt>
            <dd className="break-all font-mono text-xs text-zinc-400">sha256:{result.assertion.script_sha256}</dd></div>
        )}
      </dl>
      {result.generation_id && (
        <a href={`/verify/${result.generation_id}`}
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400 hover:text-emerald-300">
          Open the full verification page <ExternalLink className="size-3.5" />
        </a>
      )}
    </>
  );
}
