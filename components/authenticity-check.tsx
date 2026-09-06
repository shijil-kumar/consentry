"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanFace, Loader2, BadgeCheck, AlertTriangle } from "lucide-react";

export interface Authenticity {
  verdict?: "authentic" | "manipulated" | "uncertain" | "error";
  authenticity?: number | null;
  detail?: string;
  available?: boolean;
}

export function AuthenticityCheck({ consentId, initial }: { consentId: string; initial: Authenticity | null }) {
  const router = useRouter();
  const [result, setResult] = useState<Authenticity | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/consent/authenticity", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent_id: consentId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error === "detector_not_configured" ? "Add the Reality Defender key to enable this." : (j.error ?? "scan failed"));
      setResult(j.result);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  const authentic = result?.verdict === "authentic";
  const pct = result?.authenticity != null ? Math.round(result.authenticity * 100) : null;

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ScanFace className="size-4 text-primary" /> Footage authenticity
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">Reality Defender</span>
      </div>
      {result && result.verdict && result.verdict !== "error" ? (
        <div className="mt-2 flex items-center gap-2 text-sm">
          {authentic ? <BadgeCheck className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}
          <span className={authentic ? "text-emerald-700" : "text-amber-700"}>
            {authentic ? "Real human verified" : result.verdict === "uncertain" ? "Inconclusive" : "Manipulation suspected"}
            {pct != null && ` · ${pct}%`}
          </span>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            Scan your consent footage with a third-party deepfake detector to prove it&apos;s a real human.
          </p>
          <button onClick={scan} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ScanFace className="size-3.5" />}
            {busy ? "Scanning…" : "Verify authenticity"}
          </button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
