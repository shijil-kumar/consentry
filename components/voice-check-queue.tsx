"use client";

// The human end of the voice check.
//
// The consent recorder told creators "voice check pending — awaiting human
// review" while no reviewer existed anywhere in the product. This is that
// reviewer. It shows what the machine actually heard next to what it expected,
// because that comparison IS the decision: a mismatch is usually an accent or a
// noisy room, occasionally someone reading a phrase they were handed.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, X } from "lucide-react";

export interface VoiceCheckRow {
  id: string;
  created_at: string;
  org_name: string;
  phrase: string | null;
  transcript: string | null;
  hits: number | null;
  total: number | null;
  error: string | null;
}

// The stored error is a raw upstream payload like
//   stt_401: {"detail":{"code":"quota_exceeded","message":"...40 credits are required..."}}
// Dumping that at a reviewer is noise. Pull out the one sentence that decides
// what they should do, and name the operational causes explicitly.
function explainError(raw: string): { headline: string; detail: string | null } {
  const match = raw.match(/\{[\s\S]*\}/);
  let message: string | null = null;
  let code: string | null = null;
  if (match) {
    try {
      const p = JSON.parse(match[0]) as { detail?: { code?: string; message?: string } };
      message = p.detail?.message ?? null;
      code = p.detail?.code ?? null;
    } catch { /* fall back to the raw string */ }
  }
  if (code === "quota_exceeded") {
    return {
      headline: "Speech-to-text quota exhausted — this is our billing, not the creator.",
      detail: message,
    };
  }
  if (raw.startsWith("no_api_key")) {
    return { headline: "Speech-to-text is not configured — no API key on this environment.", detail: null };
  }
  return { headline: "The automated check could not run.", detail: message ?? raw.slice(0, 200) };
}

export function VoiceCheckQueue({ rows }: { rows: VoiceCheckRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function decide(id: string, decision: "accepted" | "rejected") {
    setBusy(id + decision);
    setFailed(null);
    const { error } = await supabaseBrowser().rpc("review_voice_check", {
      p_consent_id: id,
      p_decision: decision,
    });
    setBusy(null);
    if (error) { setFailed(error.message); return; }
    router.refresh();
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No voice checks awaiting review.</p>;
  }

  return (
    <div className="grid gap-4">
      {failed && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{failed}</p>
      )}
      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{r.org_name}</p>
            <span className="text-xs text-muted-foreground">
              {new Date(r.created_at).toLocaleString("en-IN", {
                day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            </span>
          </div>

          {r.error ? (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">{explainError(r.error).headline}</p>
                {explainError(r.error).detail && (
                  <p className="mt-0.5 break-words text-xs text-amber-700/90">
                    {explainError(r.error).detail}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Phrase we asked for</p>
                <p className="mt-0.5 rounded-lg bg-muted/50 px-3 py-2">{r.phrase ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">What we heard</p>
                <p className="mt-0.5 rounded-lg bg-muted/50 px-3 py-2 italic">
                  {r.transcript?.trim() ? r.transcript : "— nothing transcribed —"}
                </p>
              </div>
            </div>
          )}

          {r.total != null && (
            <Badge variant="outline" className="mt-3 font-mono text-xs">
              matched {r.hits}/{r.total} words
            </Badge>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => decide(r.id, "accepted")}>
              <Check className="size-4" />
              {busy === r.id + "accepted" ? "Saving…" : "It's them — accept"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => decide(r.id, "rejected")}>
              <X className="size-4" />
              {busy === r.id + "rejected" ? "Saving…" : "Reject — revokes consent"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Rejecting revokes the consent record, which blocks all future generation for this
            creator until they re-record. Both outcomes are written to the ledger.
          </p>
        </div>
      ))}
    </div>
  );
}
