import { config } from "dotenv"; import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { count } = await admin.from("consent_records").select("id", { count: "exact", head: true });
  console.log("total consent records:", count);
  const { data: orgs } = await admin.from("profiles").select("org_id, display_name, role").eq("role","creator");
  const name = (o: string) => (orgs ?? []).find((x: any) => x.org_id === o)?.display_name ?? "?";
  const { data } = await admin.from("consent_records")
    .select("id, status, created_at, org_id, scope").order("created_at", { ascending: false });
  for (const c of data ?? []) {
    const s = c.scope as any;
    console.log(`  ${c.id.slice(0,8)} ${String(c.status).padEnd(9)} ${c.created_at.slice(0,16)} org=${name(c.org_id)} dur=${s?.client_duration_s ?? "-"}/${s?.measured_duration_s ?? "-"} probe=${s?.probe ?? false}`);
  }
})();
