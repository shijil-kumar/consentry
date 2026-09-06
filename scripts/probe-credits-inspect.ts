// E2E probe: credit wallet (buy + balance) and /api/inspect (signed deliverable).
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  // 1) wallet: sign in as the demo brand, buy the smallest pack
  const { data: session, error: authErr } = await anon.auth.signInWithPassword({
    email: "brand@consentfirst.test", password: process.env.DEMO_PASSWORD!,
  });
  if (authErr) throw authErr;
  const asBrand = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${session.session!.access_token}` } },
    auth: { persistSession: false },
  });
  const { data: bal, error: buyErr } = await asBrand.rpc("buy_credits", { p_amount_paise: 999900 });
  console.log("buy_credits:", buyErr ? `ERR ${buyErr.message}` : `OK balance ₹${(bal as number) / 100}`);
  const { data: wallet } = await asBrand.from("credit_wallets").select("balance_paise").maybeSingle();
  console.log("wallet visible via RLS:", wallet?.balance_paise);
  const { data: otherOrgs } = await asBrand.from("credit_wallets").select("org_id");
  console.log("RLS scope (should be 1 row max):", otherOrgs?.length);

  // 2) FULL LOOP paid via credits: script check -> checkout -> wallet debit ->
  //    generation -> worker -> delivered
  const tok = session.session!.access_token;
  const H = { "content-type": "application/json", authorization: `Bearer ${tok}` };
  const { data: listing } = await admin.from("listings").select("id").eq("is_demo", false).eq("status", "published").limit(1).single();
  const { data: tier } = await admin.from("license_tiers").select("id").eq("listing_id", listing!.id).order("sort_order").limit(1).single();
  const reqRes = await fetch("http://localhost:3000/api/requests", {
    method: "POST", headers: H,
    body: JSON.stringify({
      listing_id: listing!.id, tier_id: tier!.id, category: "tech",
      script: "I have been trying the new AeroFit smart band for a week and the sleep tracking is genuinely the best I have used. Check them out at aerofit.in.",
    }),
  });
  const reqJ = await reqRes.json();
  console.log("script check:", reqRes.status, reqJ.outcome);
  if (reqJ.outcome !== "auto_approved") { console.log("aborting: not auto-approved"); return; }

  const coRes = await fetch("http://localhost:3000/api/checkout", {
    method: "POST", headers: H, body: JSON.stringify({ request_id: reqJ.request_id }),
  });
  const coJ = await coRes.json();
  console.log("checkout:", coRes.status, "license", coJ.license_id?.slice(0, 8));

  const { data: balAfter, error: payErr } = await asBrand.rpc("pay_license_with_credits", { p_license_id: coJ.license_id });
  console.log("pay_license_with_credits:", payErr ? `ERR ${payErr.message}` : `OK, balance now ₹${(balAfter as number) / 100}`);
  if (payErr) return;

  const genRes = await fetch("http://localhost:3000/api/generations", {
    method: "POST", headers: H, body: JSON.stringify({ license_id: coJ.license_id }),
  });
  const genJ = await genRes.json();
  console.log("create_generation:", genRes.status, genJ.generation_id?.slice(0, 8));

  let delivered = false;
  for (let i = 0; i < 12 && !delivered; i++) {
    await fetch("http://localhost:3000/api/jobs/generation-worker", { method: "POST", headers: H });
    const { data: g } = await admin.from("generations").select("status, error").eq("id", genJ.generation_id).single();
    if (g?.status === "delivered") delivered = true;
    else if (g?.status === "failed") { console.log("generation FAILED:", g.error); return; }
    else await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("delivered:", delivered);
  if (!delivered) return;

  const { data: gen } = await admin.from("generations").select("buyer_org_id").eq("id", genJ.generation_id).single();
  const target = `${gen!.buyer_org_id}/${genJ.generation_id}/final.mp4`;
  const { data: blob, error: dlErr } = await admin.storage.from("deliverables").download(target);
  if (dlErr || !blob) { console.log("inspect: download failed", dlErr?.message); return; }
  const fd = new FormData();
  fd.append("file", new File([await blob.arrayBuffer()], "final.mp4", { type: "video/mp4" }));
  const res = await fetch("http://localhost:3000/api/inspect", { method: "POST", body: fd });
  const j = await res.json();
  console.log("inspect status:", res.status, "| credentialed:", j.credentialed, "| platform_signed:", j.platform_signed,
    "| verdict:", j.verdict, "| creator:", j.assertion?.creator_handle, "| ledger found:", j.ledger?.found);
})().catch((e) => { console.error("PROBE FAILED:", e.message); process.exit(1); });
