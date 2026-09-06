"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Loader2, ShieldOff } from "lucide-react";

export function RevokeConsentButton({ consentId }: { consentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().rpc("revoke_consent", {
      p_consent_id: consentId, p_reason: reason || "creator revoked",
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="w-full text-destructive">
            <ShieldOff className="size-4" /> Revoke consent
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke consent?</DialogTitle>
          <DialogDescription>
            This immediately suspends your listing, disables your replica, and blocks all future
            video generation. Videos already delivered keep their credentials. This cannot be undone —
            you&apos;d need to record a new consent to go live again.
          </DialogDescription>
        </DialogHeader>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200}
          className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
          placeholder="Reason (optional, recorded in the ledger)" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={revoke} disabled={busy} className="bg-destructive/90 text-white hover:bg-destructive">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
            Revoke now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
