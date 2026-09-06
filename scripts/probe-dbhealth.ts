import { config } from "dotenv"; import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  // Leftovers from audit runs would inflate every admin count and quietly rot
  // the demo. The suite tears down after itself; this proves it.
  for (const like of ["audit-victim-%", "audit-%", "%test%"]) {
    const { count } = await admin.from("orgs").select("id", { count: "exact", head: true }).ilike("name", like);
    console.log(`orgs matching ${like.padEnd(16)} ${count}`);
  }
  const { count: orgs } = await admin.from("orgs").select("id", { count: "exact", head: true });
  const { count: gens } = await admin.from("generations").select("id", { count: "exact", head: true });
  const { count: lics } = await admin.from("licenses").select("id", { count: "exact", head: true });
  const { count: tok } = await admin.from("approval_tokens").select("token", { count: "exact", head: true }).is("used_at", null);
  const { count: pend } = await admin.from("licenses").select("id", { count: "exact", head: true }).eq("status", "payment_pending");
  console.log(`\ntotals: orgs=${orgs} generations=${gens} licenses=${lics}`);
  console.log(`unused approval tokens=${tok}  payment_pending licences=${pend}`);
  // Wallets must reconcile against the ledger — money integrity, live.
  const { data: w } = await admin.from("credit_wallets").select("org_id,balance_paise");
  let bad = 0;
  for (const row of w ?? []) {
    const { data: led } = await admin.from("credit_ledger").select("delta_paise").eq("org_id", row.org_id);
    const sum = (led ?? []).reduce((a, r: { delta_paise: number }) => a + Number(r.delta_paise), 0);
    if (sum !== Number(row.balance_paise)) { bad++; console.log(`  MISMATCH org=${row.org_id.slice(0,8)} wallet=${row.balance_paise} ledger=${sum}`); }
  }
  console.log(`wallets checked=${(w ?? []).length} mismatches=${bad}`);
})();
