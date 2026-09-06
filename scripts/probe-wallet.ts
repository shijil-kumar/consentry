import { config } from "dotenv"; import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data: wallets } = await admin.from("credit_wallets").select("org_id, balance_paise");
  for (const w of wallets ?? []) {
    const { data: led, error } = await admin.from("credit_ledger")
      .select("delta_paise, reason, ref, created_at").eq("org_id", w.org_id).order("created_at");
    if (error) { console.log(`org ${w.org_id.slice(0,8)} QUERY ERROR ${error.message}`); continue; }
    const sum = (led ?? []).reduce((a, r: any) => a + Number(r.delta_paise), 0);
    console.log(`org ${w.org_id.slice(0,8)}  wallet=${w.balance_paise}  ledger=${sum}  ${sum === Number(w.balance_paise) ? "OK" : "*** MISMATCH ***"}`);
    for (const r of led ?? []) {
      console.log(`   ${String((r as any).reason).padEnd(12)} ${String((r as any).delta_paise).padStart(9)}  ref=${String((r as any).ref ?? "-").slice(0,8)}  ${(r as any).created_at?.slice(0,16)}`);
    }
  }
})();
