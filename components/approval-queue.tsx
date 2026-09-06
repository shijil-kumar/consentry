"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Loader2, Check, X, MessageSquareWarning } from "lucide-react";

export interface ReviewRequest {
  id: string;
  category: string;
  script: string;
  created_at: string;
  buyer_org_name: string;
  listing_title: string;
  llm_reasoning: string | null;
  cited: Array<{ code: string; title: string; evidence_excerpt?: string }>;
}
export interface ClauseLite { code: string; title: string }

export function ApprovalQueue({
  requests, clauses,
}: {
  requests: ReviewRequest[];
  clauses: ClauseLite[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(requests);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ReviewRequest | null>(null);
  const [clauseCode, setClauseCode] = useState(clauses[0]?.code ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function approve(id: string) {
    setBusy(id); setError(null);
    const { error } = await supabaseBrowser().rpc("decide_request", {
      p_request_id: id, p_decision: "approved",
    });
    setBusy(null);
    if (error) { setError(error.message); return; }
    setItems(items.filter((r) => r.id !== id));
    router.refresh();
  }

  async function confirmReject() {
    if (!rejecting) return;
    setBusy(rejecting.id); setError(null);
    const { error } = await supabaseBrowser().rpc("decide_request", {
      p_request_id: rejecting.id, p_decision: "rejected",
      p_clause_code: clauseCode, p_note: note || null,
    });
    setBusy(null);
    if (error) { setError(error.message); return; }
    setItems(items.filter((r) => r.id !== rejecting.id));
    setRejecting(null); setNote("");
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Nothing to review. Requests the automated gate can&apos;t clear confidently land here.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {items.map((r) => (
        <Card key={r.id}>
          <CardContent className="space-y-3 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">{r.category}</Badge>
                <span className="text-sm text-muted-foreground">
                  {r.buyer_org_name} · {r.listing_title}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>

            <blockquote className="rounded-lg border-l-2 border-primary/40 bg-muted/50 px-4 py-3 text-sm italic">
              &ldquo;{r.script}&rdquo;
            </blockquote>

            {r.llm_reasoning && (
              <p className="flex items-start gap-2 text-sm text-amber-700">
                <MessageSquareWarning className="mt-0.5 size-4 shrink-0" />
                <span><span className="font-medium">Why it&apos;s here:</span> {r.llm_reasoning}</span>
              </p>
            )}
            {r.cited.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {r.cited.map((c) => (
                  <span key={c.code} className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs text-amber-700">
                    {c.code} {c.title}
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => approve(r.id)} disabled={busy === r.id}>
                {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setRejecting(r); setError(null); }}
                disabled={busy === r.id} className="text-destructive">
                <X className="size-4" /> Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this script</DialogTitle>
            <DialogDescription>
              Rejections must cite a rule — the buyer sees exactly why, and it&apos;s written to the ledger.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Cited rule</span>
              <select value={clauseCode} onChange={(e) => setClauseCode(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
                {clauses.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.title}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Note (optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
                className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                placeholder="A short reason for the buyer" />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button onClick={confirmReject} disabled={busy !== null || !clauseCode} className="text-destructive-foreground">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} Reject with citation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
