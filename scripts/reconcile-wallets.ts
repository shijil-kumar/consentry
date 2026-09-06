/* eslint-disable @typescript-eslint/no-explicit-any */
// Reconcile credit wallets against their ledgers.
//
// The invariant the audit checks is balance == sum(ledger deltas). It broke
// because probe cleanup deleted ledger rows for a test licence while leaving
// the balance those rows explained. The wallet figure is the one users see and
// spend, so the ledger is what gets an explanatory entry — not the other way
// round, which would silently confiscate credits.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  const { data: wallets } = await admin.from("credit_wallets").select("org_id, balance_paise");
  let fixed = 0;
  for (const w of wallets ?? []) {
    const { data: led } = await admin.from("credit_ledger")
      .select("delta_paise").eq("org_id", w.org_id);
    const sum = (led ?? []).reduce((a, r: any) => a + Number(r.delta_paise), 0);
    const balance = Number(w.balance_paise);
    if (sum === balance) { console.log(`org ${w.org_id.slice(0, 8)} already reconciled (${balance})`); continue; }
    const delta = balance - sum;
    const { error } = await admin.from("credit_ledger").insert({
      org_id: w.org_id, delta_paise: delta, balance_after: balance,
      reason: "adjustment", ref: "reconcile-after-test-cleanup",
    });
    if (error) { console.log(`org ${w.org_id.slice(0, 8)} FAILED: ${error.message}`); continue; }
    fixed++;
    console.log(`org ${w.org_id.slice(0, 8)} ledger ${sum} -> ${balance} (adjustment ${delta > 0 ? "+" : ""}${delta})`);
  }
  console.log(fixed ? `\n${fixed} wallet(s) reconciled` : "\nnothing to do");
})();
