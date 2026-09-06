"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Percent, Loader2, Check } from "lucide-react";

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export interface Pack { amount_paise: number; bonus_bps: number }

// Admin control over platform economics. Take-rate applies to every license
// payout from the moment it's saved; packs govern the brand wallet.
export function EconomicsPanel({ takeRateBps, packs }: { takeRateBps: number; packs: Pack[] }) {
  const router = useRouter();
  const [rate, setRate] = useState((takeRateBps / 100).toString());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    const bps = Math.round(parseFloat(rate) * 100);
    if (!Number.isFinite(bps) || bps < 0 || bps > 5000) {
      setError("Take-rate must be between 0% and 50%."); setBusy(false); return;
    }
    const { error } = await supabaseBrowser().rpc("update_platform_setting", {
      p_key: "take_rate_bps", p_value: bps,
    });
    if (error) setError(error.message.replace(/^SETTINGS:/, "").replace(/_/g, " "));
    else { setSaved(true); router.refresh(); }
    setBusy(false);
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <p className="flex items-center gap-2 text-sm font-medium"><Percent className="size-4 text-primary" /> Platform take-rate</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Your commission on every license. Applies to all payouts from the next sale.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Input value={rate} onChange={(e) => { setRate(e.target.value); setSaved(false); }}
            inputMode="decimal" className="w-24" aria-label="Take-rate percent" />
          <span className="text-sm text-muted-foreground">%</span>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
      <div>
        <p className="text-sm font-medium">Credit packs (brand wallet)</p>
        <ul className="mt-2 space-y-1.5">
          {packs.map((p) => (
            <li key={p.amount_paise} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{inr(p.amount_paise)}</span>
              <span className="text-xs text-muted-foreground">
                {p.bonus_bps > 0
                  ? `+${p.bonus_bps / 100}% → credits ${inr(Math.round(p.amount_paise * (1 + p.bonus_bps / 10000)))}`
                  : "no bonus (entry pack)"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Pack ladder is stored in platform settings; ask the dev console to change amounts.
        </p>
      </div>
    </div>
  );
}
