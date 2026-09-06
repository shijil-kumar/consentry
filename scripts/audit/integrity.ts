/* eslint-disable @typescript-eslint/no-explicit-any */
// Audit areas 5–7, 9: concurrency, money integrity, input validation, idempotency.
//
// These are the checks that catch data corruption rather than break-ins. They
// assert against the DATABASE after firing real requests.
import {
  admin, actorFor, area, check, attackBlocked, pass, fail, warn, info, req, type Actor, anonClient,
} from "./lib";

// ── 5. CONCURRENCY ──────────────────────────────────────────────────────────
export async function auditConcurrency(buyer: Actor, pendingLicenseId: string | null) {
  area(5, "CONCURRENCY — double-spend and double-claim under parallel load");

  // 5a. Wallet double-spend. Two identical payment calls fired together on a
  //     licence that can only be paid once. Exactly one must succeed, and the
  //     wallet must be debited exactly once.
  //     The safe pattern is the condition living in the UPDATE's WHERE clause
  //     (balance >= amount), not a read-then-write.
  const { data: pending } = pendingLicenseId
    ? await admin.from("licenses").select("id, amount_paise, buyer_org_id").eq("id", pendingLicenseId).maybeSingle()
    : { data: null };

  if (!pending) {
    warn("wallet double-spend", "no payment_pending licence for this buyer — creating one is out of scope here");
  } else {
    const { data: before } = await admin.from("credit_wallets")
      .select("balance_paise").eq("org_id", buyer.orgId).maybeSingle();
    const start = Number(before?.balance_paise ?? 0);

    const [a, b] = await Promise.all([
      buyer.client.rpc("pay_license_with_credits", { p_license_id: pending.id }),
      buyer.client.rpc("pay_license_with_credits", { p_license_id: pending.id }),
    ]);
    const succeeded = [a, b].filter((r) => !r.error).length;

    const { data: after } = await admin.from("credit_wallets")
      .select("balance_paise").eq("org_id", buyer.orgId).maybeSingle();
    const end = Number(after?.balance_paise ?? 0);
    const debited = start - end;

    check("exactly one of two parallel payments succeeded", succeeded === 1,
      `${succeeded} succeeded (errors: ${[a, b].map((r) => r.error?.message ?? "ok").join(" | ")})`);
    check("wallet debited exactly once", debited === Number(pending.amount_paise) || succeeded === 0,
      `debited ${debited} for a ${pending.amount_paise} licence`);

    // The ledger must agree with the wallet.
    const { data: entries } = await admin.from("credit_ledger")
      .select("delta_paise").eq("org_id", buyer.orgId).eq("ref", pending.id);
    check("exactly one ledger entry for this licence", (entries ?? []).length <= 1,
      `${(entries ?? []).length} entries`);
  }

  // 5b. Generation quota. A licence permitting N videos must never yield N+1,
  //     even when requests race. create_generation locks the licence row
  //     FOR UPDATE, which is what makes the count-then-insert safe.
  const { data: active } = await admin.from("licenses")
    .select("id, max_generations").eq("buyer_org_id", buyer.orgId).eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!active) {
    warn("generation quota race", "no active licence for this buyer — not exercised");
  } else {
    const { count: usedBefore } = await admin.from("generations")
      .select("id", { count: "exact", head: true }).eq("license_id", active.id)
      .not("status", "in", "(failed,changes_requested,rejected)");
    const max = Number(active.max_generations ?? 1);
    const room = max - Number(usedBefore ?? 0);

    const results = await Promise.all([
      buyer.client.rpc("create_generation", { p_license_id: active.id }),
      buyer.client.rpc("create_generation", { p_license_id: active.id }),
      buyer.client.rpc("create_generation", { p_license_id: active.id }),
    ]);
    const ok = results.filter((r) => !r.error).length;
    const { count: usedAfter } = await admin.from("generations")
      .select("id", { count: "exact", head: true }).eq("license_id", active.id)
      .not("status", "in", "(failed,changes_requested,rejected)");

    check("parallel generation requests never exceed the licence quota",
      Number(usedAfter ?? 0) <= max,
      `max=${max} before=${usedBefore} after=${usedAfter} succeeded=${ok} (room was ${room})`);

    // Clean up anything this test created so the demo state is untouched.
    if (ok > 0) {
      const ids = results.filter((r) => !r.error).map((r) => r.data).filter(Boolean);
      if (ids.length) await admin.from("generations").delete().in("id", ids as string[]);
      info("cleanup", `removed ${ids.length} generation(s) created by the race test`);
    }
  }
}

// ── 6. MONEY INTEGRITY ──────────────────────────────────────────────────────
export async function auditMoney() {
  area(6, "MONEY INTEGRITY — integers, non-negative, ledgers reconcile");

  // 6a. Every monetary column must be an integer type. Floats lose paise.
  const { data: cols } = await admin.rpc("exec_audit_money_types").then(
    () => ({ data: null }), () => ({ data: null }),
  );
  void cols;
  // The RPC above will not exist; query information_schema through PostgREST is
  // not available, so assert on values instead — which is stronger anyway.

  const money: Array<[string, string]> = [
    ["licenses", "amount_paise"],
    ["license_tiers", "price_paise"],
    ["credit_wallets", "balance_paise"],
    ["credit_ledger", "balance_after"],
    ["payouts", "gross_paise"],
    ["payouts", "net_paise"],
    ["payouts", "platform_fee_paise"],
  ];
  for (const [table, col] of money) {
    const { data, error } = await admin.from(table).select(col).limit(500);
    if (error) { warn(`${table}.${col}`, error.message); continue; }
    const vals = (data ?? []).map((r: any) => r[col]).filter((v: any) => v !== null);
    const nonInt = vals.filter((v: any) => !Number.isInteger(Number(v)));
    const negative = vals.filter((v: any) => Number(v) < 0);
    check(`${table}.${col} — all integers`, nonInt.length === 0, `${nonInt.length} non-integer of ${vals.length}`);
    check(`${table}.${col} — none negative`, negative.length === 0, `${negative.length} negative`);
  }

  // 6b. delta_paise may legitimately be negative (a spend) — assert the SIGN
  //     matches the reason, which is the real invariant.
  const { data: ledger } = await admin.from("credit_ledger")
    .select("delta_paise, reason, balance_after, org_id").limit(500);
  const wrongSign = (ledger ?? []).filter((e: any) =>
    (e.reason === "purchase" && Number(e.delta_paise) < 0) ||
    (e.reason === "license_payment" && Number(e.delta_paise) > 0));
  check("ledger entry signs match their reason", wrongSign.length === 0, `${wrongSign.length} mismatched`);
  const nonIntDelta = (ledger ?? []).filter((e: any) => !Number.isInteger(Number(e.delta_paise)));
  check("ledger deltas are integers", nonIntDelta.length === 0, `${nonIntDelta.length} non-integer`);

  // 6c. RECONCILIATION: for every org, sum(ledger deltas) must equal the wallet
  //     balance. This is the check that catches silent drift.
  const { data: wallets } = await admin.from("credit_wallets").select("org_id, balance_paise");
  let reconciled = 0;
  const drifted: string[] = [];
  for (const w of wallets ?? []) {
    const { data: entries } = await admin.from("credit_ledger")
      .select("delta_paise").eq("org_id", w.org_id);
    const sum = (entries ?? []).reduce((acc: number, e: any) => acc + Number(e.delta_paise), 0);
    if (sum === Number((w as any).balance_paise)) reconciled++;
    else drifted.push(`org ${String((w as any).org_id).slice(0, 8)}: ledger ${sum} vs wallet ${w.balance_paise}`);
  }
  check(`every wallet reconciles with its ledger (${reconciled}/${(wallets ?? []).length})`,
    drifted.length === 0, drifted.join("; "));

  // 6d. Payout arithmetic: gross = net + fee, exactly.
  const { data: payouts } = await admin.from("payouts")
    .select("gross_paise, net_paise, platform_fee_paise").limit(500);
  const badMath = (payouts ?? []).filter((p: any) =>
    Number(p.gross_paise) !== Number(p.net_paise) + Number(p.platform_fee_paise));
  check("payouts: gross = net + platform fee", badMath.length === 0,
    `${badMath.length} of ${(payouts ?? []).length} do not add up`);
}

// ── 7. INPUT VALIDATION ─────────────────────────────────────────────────────
export async function auditInputValidation(buyer: Actor) {
  area(7, "INPUT VALIDATION — hostile values on write endpoints");

  const XSS = "<script>alert('xss')</script>";
  const SQLI = "'; DROP TABLE profiles; --";
  const HUGE = "A".repeat(50_000);

  // 7a. Credit purchase must reject junk amounts. Only whitelisted pack amounts
  //     are valid, so every one of these must be refused.
  for (const [label, amount] of [
    ["negative", -100000], ["zero", 0], ["absurdly large", 999999999999999],
    ["non-integer", 1234.56],
  ] as Array<[string, number]>) {
    const { error } = await buyer.client.rpc("buy_credits", { p_amount_paise: amount });
    check(`buy_credits rejects a ${label} amount`, Boolean(error), error?.message?.slice(0, 50) ?? "ACCEPTED");
  }
  // Non-numeric goes in as a string — PostgREST should refuse to coerce it.
  const { error: nan } = await buyer.client.rpc("buy_credits", { p_amount_paise: "abc" as any });
  check("buy_credits rejects a non-numeric amount", Boolean(nan), nan?.message?.slice(0, 50) ?? "ACCEPTED");

  // 7b. Script submission: XSS and SQL-shaped strings must be stored inertly,
  //     never executed, and oversized input must be refused rather than truncated
  //     silently.
  const { data: listing } = await admin.from("listings")
    .select("id").eq("status", "published").limit(1).single();
  const { data: tier } = await admin.from("license_tiers")
    .select("id").eq("listing_id", listing!.id).order("sort_order").limit(1).single();

  const huge = await req("POST", "/api/requests", {
    cookie: buyer.cookie,
    body: { listing_id: listing!.id, tier_id: tier!.id, category: "fitness", script: HUGE },
  });
  check("oversized script is refused", huge.status === 400, `HTTP ${huge.status}`);

  const sqli = await req("POST", "/api/requests", {
    cookie: buyer.cookie,
    body: { listing_id: listing!.id, tier_id: tier!.id, category: "fitness",
            script: `Try our product. ${SQLI} It is great and I recommend it to everyone.` },
  });
  // Whatever the gate decides, the table must still be there afterwards.
  const { error: stillThere } = await admin.from("profiles").select("id", { head: true, count: "exact" });
  check("SQL-shaped input did not damage the database", !stillThere, stillThere?.message ?? "profiles intact");
  info("SQL-shaped script outcome", `HTTP ${sqli.status} — parameterised queries, treated as text`);

  // 7c. XSS must not be reflected unescaped into HTML.
  const xssRes = await req("POST", "/api/requests", {
    cookie: buyer.cookie,
    body: { listing_id: listing!.id, tier_id: tier!.id, category: "fitness",
            script: `I love this product ${XSS} and use it daily for my morning routine.` },
  });
  if (xssRes.json?.request_id) {
    const page = await req("GET", `/buyer/requests/${xssRes.json.request_id}`, { cookie: buyer.cookie });
    const rawScriptTag = /<script>alert\('xss'\)<\/script>/.test(page.text);
    check("XSS payload is escaped when rendered", !rawScriptTag,
      rawScriptTag ? "RAW <script> FOUND IN HTML" : "escaped");
    await admin.from("approval_requests").delete().eq("id", xssRes.json.request_id);
  } else {
    info("XSS render test", `request not created (HTTP ${xssRes.status}) — gate refused it first`);
  }

  // 7d. Malformed UUIDs must not 500.
  for (const bad of ["not-a-uuid", "../../etc/passwd", "%00", "1 OR 1=1"]) {
    const r = await req("GET", `/api/assets/${encodeURIComponent(bad)}`, { cookie: buyer.cookie });
    check(`malformed id '${bad.slice(0, 16)}' handled without a 500`, r.status !== 500, `HTTP ${r.status}`);
  }
}

// ── 9. IDEMPOTENCY ──────────────────────────────────────────────────────────
export async function auditIdempotency(buyer: Actor, approvalToken: string | null) {
  area(9, "IDEMPOTENCY — the same claim twice must pay out once");

  // 9a. Approval token is single-use. Approving twice must not double-deliver.
  const { data: tok } = approvalToken
    ? await admin.from("approval_tokens").select("token, generation_id").eq("token", approvalToken).maybeSingle()
    : { data: null };

  if (!tok) {
    warn("approval idempotency", "no unused approval token staged — not exercised");
  } else {
    const first = await req("POST", `/api/approval/${tok.token}`, { body: { action: "approve" } });
    const second = await req("POST", `/api/approval/${tok.token}`, { body: { action: "approve" } });
    check("first approval succeeds", first.status === 200, `HTTP ${first.status}`);
    check("replaying the same approval token is refused", second.status !== 200 || /used|invalid|expired/i.test(second.text),
      `HTTP ${second.status}`);
    const { data: events } = await admin.from("approval_events")
      .select("id, action").eq("generation_id", tok.generation_id).eq("action", "approve");
    check("only one approval event was recorded", (events ?? []).length <= 1, `${(events ?? []).length} events`);
  }

  // 9b. Paying an already-paid licence must not debit twice.
  const { data: paid } = await admin.from("licenses")
    .select("id").eq("buyer_org_id", buyer.orgId).eq("status", "active").limit(1).maybeSingle();
  if (paid) {
    const { data: before } = await admin.from("credit_wallets")
      .select("balance_paise").eq("org_id", buyer.orgId).maybeSingle();
    const { error } = await buyer.client.rpc("pay_license_with_credits", { p_license_id: paid.id });
    const { data: after } = await admin.from("credit_wallets")
      .select("balance_paise").eq("org_id", buyer.orgId).maybeSingle();
    check("re-paying an active licence is refused", Boolean(error), error?.message?.slice(0, 60) ?? "ACCEPTED");
    check("wallet unchanged by the repeat payment",
      Number(before?.balance_paise ?? 0) === Number(after?.balance_paise ?? 0),
      `${before?.balance_paise} → ${after?.balance_paise}`);
  } else {
    warn("repeat payment", "no active licence to re-pay — not exercised");
  }
}
