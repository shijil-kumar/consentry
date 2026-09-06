"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ProcessSteps } from "@/components/process-steps";
import { FileWarning, Download, Loader2 } from "lucide-react";

// Cease-and-desist draft generator — the protection product's teeth. Drafting
// is real (live AI, grounded in the ledger); SENDING is a disclosed Phase-2
// service, so the output is a downloadable draft for the lawyer.
export function CndGenerator() {
  const [target, setTarget] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [letter, setLetter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function draft() {
    setBusy(true); setError(null); setLetter(null);
    try {
      const r = await fetch("/api/protection/cnd", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, description }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error === "drafter_unavailable" ? "The AI drafter needs the Anthropic key." : (j.error ?? "draft failed"));
      setLetter(j.letter);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  function download() {
    if (!letter) return;
    const blob = new Blob([letter], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cease-and-desist-draft.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="grid gap-3">
      <input value={target} onChange={(e) => setTarget(e.target.value)} maxLength={200}
        placeholder="Where did you see it? (link or platform name)"
        className="h-10 rounded-lg border border-input bg-background px-3 text-sm" />
      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000}
        placeholder="What does the video/image show? (e.g. an AI version of me endorsing a betting app)" />
      <Button onClick={draft} disabled={busy || target.trim().length < 3 || description.trim().length < 10} className="w-fit">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FileWarning className="size-4" />}
        Draft cease &amp; desist
      </Button>
      {busy && (
        <div className="rounded-xl border bg-muted/40 p-4">
          <ProcessSteps active={1} steps={[
            { label: "Pulling your consent-registry facts", detail: "Your verified consent record anchors the legal claim." },
            { label: "Drafting the letter", detail: "Grounded in IT Rules 2026 + Indian personality-rights rulings." },
            { label: "Ready for your lawyer", detail: "You download the draft — nothing is sent automatically." },
          ]} />
        </div>
      )}
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {letter && (
        <div className="rounded-xl border bg-muted/30 p-4">
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">{letter}</pre>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Draft only — review with your lawyer. Automated sending arrives in Phase 2.</p>
            <Button size="sm" variant="outline" onClick={download}><Download className="size-4" /> Download</Button>
          </div>
        </div>
      )}
    </div>
  );
}
