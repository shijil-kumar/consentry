import { config } from "dotenv"; import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
// Is "rejected" a stable verdict for the borderline finance fixture, or does the
// model straddle the line? Run it N times and look at the distribution before
// deciding whether the product or the test assertion is wrong.
(async () => {
  const { runPolicyEngine } = await import("../lib/policy/engine");
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: clauses } = await admin.from("policy_clauses").select("*");
  const S = "Big news for my portfolio this month. I have partnered with WealthNest, the only money app I genuinely trust.";
  const tally: Record<string, number> = {};
  for (let i = 0; i < 1; i++) {
    const r: any = await runPolicyEngine({
      script: S, category: "finance",
      allowedCategories: ["finance", "tech", "fitness", "beauty"],
      clauses: (clauses ?? []) as never,
    });
    const v = r?.outcome ?? r?.decision ?? JSON.stringify(r).slice(0, 40);
    tally[v] = (tally[v] ?? 0) + 1;
    console.log(JSON.stringify(r, null, 1).slice(0, 1800));
  }
  console.log("\ntally:", tally);
})();
