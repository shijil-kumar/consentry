"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Wallet, Loader2 } from "lucide-react";

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// Mirrors platform_settings.credit_packs (competitor-informed ladder: low
// entry like HeyGen's $30 top-up, bonuses reward prepayment).
const PACKS: Array<{ pay: number; bonusBps: number }> = [
  { pay: 249900, bonusBps: 0 },
  { pay: 999900, bonusBps: 500 },
  { pay: 2499900, bonusBps: 1000 },
  { pay: 4999900, bonusBps: 1500 },
];

// Prepaid campaign credits: buy once, license many times — no per-video
// checkout. Purchases are simulated while payments run in mock mode; the
// same wallet gets topped up by the Razorpay webhook once keys arrive.
export function CreditWallet({ balancePaise }: { balancePaise: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy(pack: number) {
    setBusy(pack); setError(null);
    const { error } = await supabaseBrowser().rpc("buy_credits", { p_amount_paise: pack });
    if (error) setError(error.message.replace(/^CREDITS:/, "").replace(/_/g, " "));
    else router.refresh();
    setBusy(null);
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Wallet className="size-4" /> Campaign credits
      </div>
      <p className="mt-1 text-2xl font-semibold">{inr(balancePaise)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Prepay once — licenses debit instantly, no checkout per video.
      </p>
      {/* The three commitments, stated where the money sits. Straight from the
          competitor-review research (2026-08-01): Billo expires prepaid
          balances after 12 months, Cameo traps refunds as platform credit,
          and Cameo bills for orders that silently die. These are the exact
          inversions, and each one is enforced by the schema (no expiry field
          exists; failed/rejected generations never debit). */}
      <ul className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
        <li>· Credits never expire</li>
        <li>· Money moves only when an approved video is delivered</li>
        <li>· Unused balance is refundable to your original payment method</li>
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {PACKS.map((p) => (
          <Button key={p.pay} variant="outline" size="sm" disabled={busy !== null} onClick={() => buy(p.pay)}
            className="h-auto flex-col items-start gap-0 py-1.5">
            {busy === p.pay
              ? <Loader2 className="size-3.5 animate-spin" />
              : <>
                  <span className="text-sm font-semibold">{inr(p.pay)}</span>
                  <span className="text-[10px] font-normal text-muted-foreground">
                    {p.bonusBps > 0 ? `+${p.bonusBps / 100}% bonus → ${inr(Math.round(p.pay * (1 + p.bonusBps / 10000)))}` : "starter pack"}
                  </span>
                </>}
          </Button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
