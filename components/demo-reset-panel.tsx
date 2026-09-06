"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RotateCcw, Loader2, Check, Copy, ExternalLink } from "lucide-react";

// One-tap demo staging, from any browser — so a demo never depends on having
// the project checked out on the machine in the room.
export function DemoResetPanel() {
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [approveUrl, setApproveUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    setBusy(true); setError(null); setSteps([]); setApproveUrl(null);
    try {
      const r = await fetch("/api/demo/reset", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail ?? j.error ?? "Reset failed");
      setSteps(j.steps ?? []); setApproveUrl(j.approve_url ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <Card className="border-amber-500/30 bg-amber-500/[0.04]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RotateCcw className="size-4 text-amber-600" /> Stage a demo
        </CardTitle>
        <CardDescription>
          Puts one video in “waiting for your approval”, refills the escalated-script
          queue and the takedown desk, and gives you the approve-on-phone link.
          Uses the free mock engine — no provider credit is spent. Run it right
          before you present.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={run} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
          {busy ? "Staging… (about 20 seconds)" : "Stage the demo"}
        </Button>

        {error && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {steps.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {steps.map((s) => (
              <li key={s} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> {s}
              </li>
            ))}
          </ul>
        )}

        {approveUrl && (
          <div className="mt-4 rounded-lg border bg-background p-3">
            <p className="text-sm font-medium">Your review link — open it anywhere (a phone demos best)</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2 py-1.5 text-xs">
                {approveUrl}
              </code>
              <Button size="sm" variant="outline" onClick={() => {
                navigator.clipboard.writeText(approveUrl);
                setCopied(true); setTimeout(() => setCopied(false), 1800);
              }}>
                {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button size="sm" variant="outline" render={<a href={approveUrl} target="_blank" rel="noreferrer" />} nativeButton={false}>
                <ExternalLink className="size-3.5" /> Open
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
