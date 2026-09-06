// Security regressions pinned by the 2026-08-05 pentest.
//
// Each test is an ATTACK that must fail. They run against the live project with
// the demo role accounts, using the publishable (anon) key exactly as a real
// client — never the service role — so they exercise the same RLS + RPC guards
// an attacker would hit.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = process.env.DEMO_PASSWORD ?? "ConsentDemo-2026!";

const admin = createClient(URL_, SECRET, { auth: { persistSession: false } });

async function asRole(email: string): Promise<SupabaseClient> {
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}

let buyer: SupabaseClient;
let creator: SupabaseClient;
const anon = () => createClient(URL_, ANON, { auth: { persistSession: false } });

beforeAll(async () => {
  buyer = await asRole("brand@consentfirst.test");
  creator = await asRole("arjun@consentfirst.test");
});

describe("payment-bypass guard (buy_credits)", () => {
  afterAll(async () => {
    // Always leave the demo in test mode.
    await admin.from("platform_settings").update({ value: false }).eq("key", "payments_live");
  });

  it("refuses to mint free credits once payments are live", async () => {
    await admin.from("platform_settings").update({ value: true }).eq("key", "payments_live");
    const { error } = await buyer.rpc("buy_credits", { p_amount_paise: 249900 });
    expect(error?.message ?? "").toContain("CREDITS:live_mode_use_checkout");
  });

  it("in test mode the live guard is not what stops an invalid pack", async () => {
    await admin.from("platform_settings").update({ value: false }).eq("key", "payments_live");
    // An invalid pack proves we got PAST the live guard (test mode works) without
    // actually minting anything.
    const { error } = await buyer.rpc("buy_credits", { p_amount_paise: 1 });
    expect(error?.message ?? "").toContain("CREDITS:invalid_pack");
  });
});

describe("privilege escalation is blocked", () => {
  it("a buyer cannot change the platform take-rate", async () => {
    const { error } = await buyer.rpc("update_platform_setting", { p_key: "take_rate_bps", p_value: 0 });
    expect(error?.message ?? "").toContain("SETTINGS:admin_only");
  });

  it("a buyer cannot self-approve KYC", async () => {
    const { data: me } = await buyer.auth.getUser();
    const { error } = await buyer.rpc("set_kyc_status", { p_profile: me.user!.id, p_status: "verified" });
    expect(error?.message ?? "").toContain("KYC:admin_only");
  });

  it("a buyer cannot flip payments_live to re-open free credits", async () => {
    const { error } = await buyer.rpc("update_platform_setting", { p_key: "payments_live", p_value: false });
    expect(error?.message ?? "").toContain("SETTINGS:admin_only");
  });
});

describe("credential tables are unreadable to clients", () => {
  it("the approval token never reaches a buyer or creator or anon", async () => {
    for (const [who, c] of [["buyer", buyer], ["creator", creator], ["anon", anon()]] as const) {
      const { data } = await c.from("approval_tokens").select("token").limit(1);
      expect(data ?? [], `${who} read approval_tokens`).toHaveLength(0);
    }
  });

  it("consent handoff tokens are denied to anon", async () => {
    const { data, error } = await anon().from("consent_handoff_tokens").select("token").limit(1);
    expect(error || (data ?? []).length === 0).toBeTruthy();
  });
});
