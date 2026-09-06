"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Loader2, PlayCircle, RefreshCcw, Sparkles, XCircle, BadgeCheck } from "lucide-react";

export interface AvatarSnapshot {
  id: string;
  status: "training" | "ready" | "failed" | "disabled";
  provider: string;
  preview_video_url: string | null;
  error: string | null;
  consent_record_id: string;
}

// B2.3 — live replica status. Webhooks accelerate, this poll guarantees:
// reads the row every 4s and re-kicks the worker (reconcile) every 12s.
export function ReplicaCard({
  initialAvatar,
  consentId,
  consentStatus,
}: {
  initialAvatar: AvatarSnapshot | null;
  consentId: string | null;
  consentStatus: "pending" | "verified" | "revoked" | null;
}) {
  const router = useRouter();
  const [avatar, setAvatar] = useState<AvatarSnapshot | null>(initialAvatar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const tickRef = useRef(0);

  const kickWorker = useCallback(async () => {
    try {
      await fetch("/api/jobs/replica-worker", { method: "POST" });
    } catch {
      /* poller will retry */
    }
  }, []);

  useEffect(() => {
    if (avatar?.status !== "training") return;
    const interval = setInterval(async () => {
      tickRef.current += 1;
      setElapsed((e) => e + 4);
      if (tickRef.current % 3 === 0) await kickWorker();
      const { data } = await supabaseBrowser()
        .from("avatars")
        .select("id, status, provider, preview_video_url, error, consent_record_id")
        .eq("id", avatar.id)
        .single<AvatarSnapshot>();
      if (data && data.status !== "training") {
        setAvatar(data);
        router.refresh(); // consent badge may have flipped to verified
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [avatar?.id, avatar?.status, kickWorker, router]);

  async function startTraining() {
    if (!consentId) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { data: userRes } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from("profiles").select("org_id").eq("id", userRes.user!.id).single();
      const { data, error: insErr } = await supabase
        .from("avatars")
        .insert({
          org_id: profile!.org_id,
          creator_id: userRes.user!.id,
          consent_record_id: consentId,
        })
        .select("id, status, provider, preview_video_url, error, consent_record_id")
        .single<AvatarSnapshot>();
      if (insErr) throw insErr;
      setAvatar(data);
      setElapsed(0);
      await kickWorker();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!consentId) {
    return (
      <p className="text-sm text-muted-foreground">
        Appears here after your consent recording is on file.
      </p>
    );
  }

  if (!avatar || avatar.status === "disabled") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {avatar?.status === "disabled"
            ? "Your replica was disabled when consent was revoked. Record a new consent to train again."
            : "Your consent recording doubles as training footage — start training whenever you're ready."}
        </p>
        {consentStatus !== "revoked" && (
          <Button onClick={startTraining} disabled={busy} className="w-full">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Train my replica
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  if (avatar.status === "training") {
    return (
      <div className="space-y-3">
        <Badge variant="outline" className="bg-amber-500/15 text-amber-600 border-amber-500/30">
          <Loader2 className="size-3.5 animate-spin" /> Training
        </Badge>
        <p className="text-sm text-muted-foreground">
          The provider is building your replica from the consent footage.
          {elapsed > 0 && ` ${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed.`}{" "}
          Live training takes 3–4 hours — you&apos;ll see it flip here automatically.
        </p>
      </div>
    );
  }

  if (avatar.status === "failed") {
    return (
      <div className="space-y-3">
        <Badge variant="outline" className="bg-red-500/15 text-red-600 border-red-500/30">
          <XCircle className="size-3.5" /> Training failed
        </Badge>
        {avatar.error && (
          <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{avatar.error}</p>
        )}
        <Button onClick={startTraining} disabled={busy} variant="outline" className="w-full">
          <RefreshCcw className="size-4" /> Retry training
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
        <BadgeCheck className="size-3.5" /> Replica ready
      </Badge>
      {avatar.preview_video_url ? (
        <video src={avatar.preview_video_url} controls playsInline className="w-full rounded-lg border" />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <PlayCircle className="size-4" />
          {avatar.provider === "mock"
            ? "Mock replica (dev engine) — preview arrives with the live provider."
            : "Preview processing…"}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Next: set your prices and your no-go rules on the marketplace listing — brands can
        only work within them.
      </p>
    </div>
  );
}
