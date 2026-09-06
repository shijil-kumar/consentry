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
    const r: Awaited<ReturnType<typeof runPolicyEngine>> = await runPolicyEngine({
      script: S, category: "finance",
      allowedCategories: ["finance", "tech", "fitness", "beauty"],
      clauses: (clauses ?? []) as never,
    });
    // `r.decision` used to be read here as a fallback. No such field has ever
    // existed on PolicyReport -- an `any` was hiding it, so a probe meant to
    // tally verdicts would have silently tallied a JSON fragment had outcome
    // ever been absent. It cannot be: the type says so.
    const v = r.outcome;
    tally[v] = (tally[v] ?? 0) + 1;
    console.log(JSON.stringify(r, null, 1).slice(0, 1800));
  }
  console.log("\ntally:", tally);
})();
