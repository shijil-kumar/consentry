"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Smartphone, Loader2, Copy, Check, RefreshCw } from "lucide-react";

interface Handoff { url: string; qr_png: string; expires_at: string }

// Desktop -> phone handoff. A laptop webcam is usually the worst camera a
// creator owns; their phone is the best. Scan, record there, done.
export function ConsentPhoneHandoff() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Handoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function mint() {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/consent/handoff", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error === "creators_only"
        ? "Only your creator account can start a phone recording."
        : "Couldn't create the link. Try again.");
      setData(j); setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  const msLeft = data && now ? new Date(data.expires_at).getTime() - now : null;
  const expired = msLeft !== null && msLeft <= 0;
  const mmss = msLeft !== null && msLeft > 0
    ? `${Math.floor(msLeft / 60000)}:${String(Math.floor((msLeft % 60000) / 1000)).padStart(2, "0")}`
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="size-4 text-primary" /> Rather use your phone?
        </CardTitle>
        <CardDescription>
          Your phone camera is almost always better than a laptop webcam — and the
          recording quality here decides how good your AI likeness looks.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!open ? (
          <>
            <Button onClick={mint} disabled={busy} variant="outline">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
              Record on my phone
            </Button>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </>
        ) : (
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <div className={`shrink-0 rounded-xl border bg-white p-2 ${expired ? "opacity-30" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data!.qr_png} width={220} height={220}
                alt="QR code — scan with your phone camera to continue recording there" />
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">Scan it with your phone camera</p>
              <p className="mt-1 text-muted-foreground">
                You&apos;ll land on the same consent page, already signed in. Record there,
                and it appears here automatically.
              </p>

              <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2 py-1.5 text-xs">
                  {data!.url}
                </code>
                <Button size="sm" variant="outline" onClick={() => {
                  navigator.clipboard.writeText(data!.url);
                  setCopied(true); setTimeout(() => setCopied(false), 1800);
                }}>
                  {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                {expired
                  ? "This code has expired."
                  : mmss
                    ? `Single-use, and expires in ${mmss}.`
                    : "Single-use link."}
              </p>
              <Button size="sm" variant="ghost" className="mt-1 px-0" onClick={mint} disabled={busy}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Get a fresh code
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
