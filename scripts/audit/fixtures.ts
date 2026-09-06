/* eslint-disable @typescript-eslint/no-explicit-any */
// Fixtures that make the dangerous tests actually RUN.
//
// The first audit pass reported six checks as "not exercised": there was no
// second tenant to attack, no unpaid licence to double-spend, no unused approval
// token to replay. Those checks were worthless — a suite that skips the hard
// cases and prints green is actively misleading. This module manufactures the
// preconditions, and tears them down afterwards.
import { admin, info, warn } from "./lib";

export interface Fixtures {
  /** A generation owned by an org OTHER than the buyer under test (IDOR target). */
  foreignGenerationId: string | null;
  /** A licence in payment_pending owned by the buyer (double-spend target). */
  pendingLicenseId: string | null;
  /** An unused approval token (replay target). */
  approvalToken: string | null;
  cleanup: () => Promise<void>;
}

export async function buildFixtures(buyerOrgId: string): Promise<Fixtures> {
  const created: Array<() => Promise<void>> = [];
  let foreignGenerationId: string | null = null;
  let pendingLicenseId: string | null = null;
  let approvalToken: string | null = null;

  // ── 1. A generation belonging to a DIFFERENT buyer org ────────────────────
  const { data: existingForeign } = await admin.from("generations")
    .select("id").neq("buyer_org_id", buyerOrgId).limit(1).maybeSingle();
  if (existingForeign) {
    foreignGenerationId = existingForeign.id;
    info("fixture: foreign generation", "reused an existing one (no cleanup needed)");
  } else {
    // Manufacture a second tenant so the IDOR test has a real victim.
    const { data: otherOrg, error: orgErr } = await admin.from("orgs")
      .insert({ type: "brand", name: `audit-victim-${Date.now().toString(36)}` })
      .select("id").single();
    if (orgErr || !otherOrg) {
      warn("fixture: foreign generation", `could not create victim org: ${orgErr?.message}`);
    } else {
      // Registered FIRST so that, under LIFO teardown, it is removed LAST —
      // after the generation that references it.
      created.push(async () => { await admin.from("orgs").delete().eq("id", otherOrg.id); });
      const { data: anyGen } = await admin.from("generations")
        .select("license_id, request_id, creator_org_id, script, script_hash, provider")
        .limit(1).maybeSingle();
      if (!anyGen) {
        warn("fixture: foreign generation", "no template generation to clone");
      } else {
        const { data: g, error: gErr } = await admin.from("generations").insert({
          ...anyGen, buyer_org_id: otherOrg.id, status: "delivered",
        }).select("id").single();
        if (gErr || !g) warn("fixture: foreign generation", gErr?.message ?? "insert failed");
        else {
          foreignGenerationId = g.id;
          created.push(async () => { await admin.from("generations").delete().eq("id", g.id); });
          info("fixture: foreign generation", `created ${g.id.slice(0, 8)}… under a second org`);
        }
      }
    }
  }

  // ── 2. A payment_pending licence for the buyer (double-spend target) ──────
  const { data: existingPending } = await admin.from("licenses")
    .select("id").eq("buyer_org_id", buyerOrgId).eq("status", "payment_pending").limit(1).maybeSingle();
  if (existingPending) {
    pendingLicenseId = existingPending.id;
    info("fixture: pending licence", "reused an existing one");
  } else {
    // Clone the shape of a real licence so every NOT NULL column is satisfied.
    const { data: tmpl } = await admin.from("licenses")
      .select("request_id, creator_org_id, listing_id, tier_id, amount_paise, tier_name, max_generations, duration_days, exclusivity")
      .eq("buyer_org_id", buyerOrgId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    // licenses.request_id is UNIQUE — reusing the template's request violates it,
    // so mint a dedicated approval_request for this fixture.
    const { data: reqTmpl } = tmpl
      ? await admin.from("approval_requests").select("*").eq("id", tmpl.request_id).maybeSingle()
      : { data: null };
    let freshRequestId: string | null = null;
    if (reqTmpl) {
      const clone: any = { ...reqTmpl };
      delete clone.id; delete clone.created_at; delete clone.decided_at; delete clone.decided_by;
      clone.expires_at = new Date(Date.now() + 24 * 3600_000).toISOString();
      const { data: r, error: rErr } = await admin.from("approval_requests").insert(clone).select("id").single();
      if (rErr || !r) warn("fixture: pending licence", `request clone failed: ${rErr?.message}`);
      else {
        freshRequestId = r.id;
        created.push(async () => { await admin.from("approval_requests").delete().eq("id", r.id); });
      }
    }
    if (!tmpl || !freshRequestId) {
      warn("fixture: pending licence", tmpl ? "could not mint a request" : "no template licence for this buyer");
    } else {
      // SIZE THE LICENCE TO THE WALLET. The double-spend test is only meaningful
      // when the balance covers EXACTLY ONE payment: then one of two parallel
      // attempts must win and the other must be refused. A licence priced above
      // the balance makes both fail for the wrong reason and proves nothing
      // about concurrency (that is what happened on the first run).
      const { data: w } = await admin.from("credit_wallets")
        .select("balance_paise").eq("org_id", buyerOrgId).maybeSingle();
      const balance = Number(w?.balance_paise ?? 0);
      let amount = Number(tmpl.amount_paise);
      if (balance <= 0) {
        // No funds: top up just enough, and put it back afterwards.
        //
        // THROUGH THE LEDGER, not by writing the balance. Area 6 asserts
        // balance == sum(ledger), and this fixture runs BEFORE that check — so
        // a bare balance write manufactured the very inconsistency the check
        // exists to catch, and the suite reported a money-integrity failure
        // against itself three times before the cause was traced here.
        amount = 100_00;
        const TOPUP_REF = `audit-fixture-topup-${Date.now().toString(36)}`;
        await admin.from("credit_wallets").upsert(
          { org_id: buyerOrgId, balance_paise: amount }, { onConflict: "org_id" });
        await admin.from("credit_ledger").insert({
          org_id: buyerOrgId, delta_paise: amount, balance_after: amount,
          reason: "adjustment", ref: TOPUP_REF,
        });
        created.push(async () => {
          await admin.from("credit_ledger").delete().eq("ref", TOPUP_REF);
          await admin.from("credit_wallets").update({ balance_paise: balance }).eq("org_id", buyerOrgId);
        });
      } else if (amount > balance) {
        amount = balance;      // exactly one payment can clear
      }
      // Always restore the starting balance so the audit leaves no trace.
      created.push(async () => {
        await admin.from("credit_wallets").update({ balance_paise: balance }).eq("org_id", buyerOrgId);
      });
      const { data: lic, error } = await admin.from("licenses").insert({
        ...tmpl, request_id: freshRequestId, buyer_org_id: buyerOrgId,
        status: "payment_pending", amount_paise: amount,
      }).select("id").single();
      if (error || !lic) warn("fixture: pending licence", error?.message ?? "insert failed");
      else {
        pendingLicenseId = lic.id;
        created.push(async () => {
          await admin.from("credit_ledger").delete().eq("ref", lic.id);
          await admin.from("licenses").delete().eq("id", lic.id);
        });
        info("fixture: pending licence", `created ${lic.id.slice(0, 8)}… at ${amount} paise (wallet holds ${balance})`);
      }
    }
  }

  // ── 3. An unused approval token (replay target) ───────────────────────────
  const { data: existingTok } = await admin.from("approval_tokens")
    .select("token").is("used_at", null).limit(1).maybeSingle();
  if (existingTok) {
    approvalToken = existingTok.token;
    info("fixture: approval token", "reused a staged, unused token");
  } else {
    let { data: gen } = await admin.from("generations")
      .select("id").eq("status", "celebrity_review").limit(1).maybeSingle();
    if (!gen) {
      // Manufacture one rather than skip: an un-run replay test is worthless.
      const { data: tmplGen } = await admin.from("generations")
        .select("license_id, request_id, buyer_org_id, creator_org_id, script, script_hash, provider, preview_path")
        .not("preview_path", "is", null).limit(1).maybeSingle();
      if (tmplGen) {
        const { data: g, error } = await admin.from("generations")
          .insert({ ...tmplGen, status: "celebrity_review" }).select("id").single();
        if (error || !g) warn("fixture: approval token", `could not stage a review generation: ${error?.message}`);
        else {
          gen = g;
          created.push(async () => {
            await admin.from("approval_events").delete().eq("generation_id", g.id);
            await admin.from("generations").delete().eq("id", g.id);
          });
          info("fixture: review generation", `staged ${g.id.slice(0, 8)}… for the replay test`);
        }
      }
    }
    if (!gen) {
      warn("fixture: approval token", "no generation awaiting review — replay test cannot run");
    } else {
      const token = `audit_${Buffer.from(crypto.randomUUID()).toString("base64url").slice(0, 32)}`;
      const { error } = await admin.from("approval_tokens").insert({
        token, generation_id: gen.id,
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      });
      if (error) warn("fixture: approval token", error.message);
      else {
        approvalToken = token;
        created.push(async () => { await admin.from("approval_tokens").delete().eq("token", token); });
        info("fixture: approval token", "minted a disposable one");
      }
    }
  }

  return {
    foreignGenerationId, pendingLicenseId, approvalToken,
    cleanup: async () => {
      for (const undo of created.reverse()) await undo().catch(() => {});
      if (created.length) info("fixtures cleaned up", `${created.length} object(s) removed`);
    },
  };
}
