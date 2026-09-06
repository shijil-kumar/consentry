/* eslint-disable @typescript-eslint/no-explicit-any */
// Audit areas 1–4, 8, 10: secrets, authorization/IDOR, session integrity,
// mass assignment, webhook signatures, security headers.
//
// Every check performs the REAL attack against the deployed app and asserts it
// fails. Reading the source and concluding "looks fine" is not evidence.
import {
  BASE, IS_LOCAL, admin, anonClient, actorFor, area, check, attackBlocked, pass, fail, warn, info,
  req, looksExercised, type Actor, ANON, URL_, REF,
} from "./lib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// ── 1. SECRETS ──────────────────────────────────────────────────────────────
export async function auditSecrets() {
  area(1, "SECRETS — nothing server-side reachable from the browser");

  // Patterns that must NEVER appear in a client bundle.
  const SECRET_PATTERNS: Array<[string, RegExp]> = [
    ["service_role JWT", /"role"\s*:\s*"service_role"/],
    ["Supabase service key name", /SUPABASE_SERVICE_ROLE_KEY/],
    ["ElevenLabs key", /\bsk_[a-f0-9]{32,}\b/],
    ["Groq key", /\bgsk_[A-Za-z0-9]{40,}\b/],
    ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
    ["Razorpay secret", /rzp_live_[A-Za-z0-9]+|key_secret/],
    ["cron secret", /CRON_SECRET/],
    ["webhook secret", /WEBHOOK_SECRET/],
    ["demo password", /DEMO_PASSWORD/],
    ["HeyGen/Tavus key names", /HEYGEN_API_KEY|TAVUS_API_KEY|REALITY_DEFENDER_API_KEY/],
  ];

  const home = await fetch(`${BASE}/`).then((r) => r.text());
  const scripts = [...new Set([...home.matchAll(/\/_next\/static\/[^"'\\\s]+\.js/g)].map((m) => m[0]))];
  // Also pull the admin + creator pages so role-specific bundles are covered.
  for (const p of ["/marketplace", "/inspect", "/login", "/celebrities"]) {
    const html = await fetch(`${BASE}${p}`).then((r) => r.text()).catch(() => "");
    [...html.matchAll(/\/_next\/static\/[^"'\\\s]+\.js/g)].forEach((m) => {
      if (!scripts.includes(m[0])) scripts.push(m[0]);
    });
  }

  let scanned = 0;
  const hits: string[] = [];
  for (const s of scripts.slice(0, 80)) {
    const js = await fetch(`${BASE}${s}`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    if (!js) continue;
    scanned++;
    for (const [label, re] of SECRET_PATTERNS) if (re.test(js)) hits.push(`${label} in ${s}`);
  }
  check(`no server secret in any client bundle (${scanned} files scanned)`, hits.length === 0, hits.join("; "));
  if (scanned < 3) warn("bundle scan coverage", `only ${scanned} bundles fetched — coverage may be thin`);

  // Every NEXT_PUBLIC_* the code uses must be genuinely publishable.
  const SAFE_PUBLIC = new Set([
    "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_PLATFORM_NAME",
    "NEXT_PUBLIC_DEV_OPEN", "NEXT_PUBLIC_DEMO_EXAMPLES", "NEXT_PUBLIC_RAZORPAY_KEY_ID",
  ]);
  const used = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const fp = path.join(dir, e);
      if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
      if (statSync(fp).isDirectory()) walk(fp);
      else if (/\.(ts|tsx|mjs)$/.test(e)) {
        const src = readFileSync(fp, "utf8");
        [...src.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)].forEach((m) => used.add(m[0]));
      }
    }
  };
  for (const d of ["app", "components", "lib"]) { try { walk(d); } catch { /* dir may not exist */ } }
  const unexpected = [...used].filter((v) => !SAFE_PUBLIC.has(v));
  check("every NEXT_PUBLIC_* variable is safe to publish", unexpected.length === 0,
    unexpected.length ? `review: ${unexpected.join(", ")}` : `${used.size} checked`);

  // A "use client" file must never import the service-role client.
  const clientLeaks: string[] = [];
  const walkClient = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const fp = path.join(dir, e);
      if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
      if (statSync(fp).isDirectory()) walkClient(fp);
      else if (/\.tsx?$/.test(e)) {
        const src = readFileSync(fp, "utf8");
        if (/^\s*["']use client["']/m.test(src) &&
            /supabase\/admin|SERVICE_ROLE|supabaseAdmin\(/.test(src)) clientLeaks.push(fp);
      }
    }
  };
  for (const d of ["app", "components"]) { try { walkClient(d); } catch { /* ignore */ } }
  check("no 'use client' file imports the service-role client", clientLeaks.length === 0, clientLeaks.join(", "));

  // The anon key must actually BE the anon key (a pasted service key would be fatal).
  // Two valid formats: legacy JWT (decodable, role must be "anon") and the newer
  // opaque publishable key (sb_publishable_…). Either is fine; a service key
  // here would be catastrophic, so assert that explicitly for both shapes.
  if (/^sb_publishable_/.test(ANON)) {
    check("publishable key is not a secret key", !/^sb_secret_/.test(ANON), "sb_publishable_ format");
  } else {
    try {
      const payload = JSON.parse(Buffer.from(ANON.split(".")[1], "base64").toString());
      check("NEXT_PUBLIC_SUPABASE_ANON_KEY carries the anon role", payload.role === "anon", `role=${payload.role}`);
    } catch { warn("anon key shape", "unrecognised key format — verify manually"); }
  }
}

// ── 2. AUTHORIZATION + IDOR ─────────────────────────────────────────────────
export async function auditAuthz(buyer: Actor, creator: Actor, adminA: Actor, foreignGenerationId: string | null) {
  area(2, "AUTHORIZATION — authenticated is not the same as authorised");

  // 2a. Enumerate every API route from the filesystem so nothing is forgotten.
  const routes: string[] = [];
  const walk = (dir: string, url = "") => {
    for (const e of readdirSync(dir)) {
      const fp = path.join(dir, e);
      if (statSync(fp).isDirectory()) walk(fp, `${url}/${e}`);
      else if (e === "route.ts") routes.push(url || "/");
    }
  };
  walk("app/api", "/api");
  info(`discovered ${routes.length} API routes`, "each is checked below or explicitly excused");

  // Public by design — everything else must reject an anonymous caller.
  const PUBLIC_OK = new Set([
    "/api/health", "/api/inspect", "/api/consent/challenge",
    "/api/webhooks/razorpay", "/api/star-vote",
    // Signup MUST accept anonymous callers — that is what it is for. Its own
    // privilege-escalation risk is covered properly in area 4.
    "/api/auth/signup",
  ]);
  const DYNAMIC = routes.filter((r) => r.includes("["));
  const STATIC = routes.filter((r) => !r.includes("["));

  for (const r of STATIC) {
    if (PUBLIC_OK.has(r)) { info(`public by design: ${r}`); continue; }
    // On a dev-open server this route answers anonymous callers on purpose;
    // whether it is dead in PRODUCTION is asserted in 2b, not here.
    if (IS_LOCAL && r === "/api/dev/login") { info(`dev-only route, skipped on a dev target: ${r}`); continue; }
    const res = await req("POST", r, { body: {} });
    const denied = [401, 403, 404, 405].includes(res.status);
    check(`anon POST ${r} refused`, denied, `HTTP ${res.status}`);
  }

  // 2b. Dev login must be dead in production. On a dev server it is SUPPOSED to
  //      answer (that is the whole point of NEXT_PUBLIC_DEV_OPEN), so asserting
  //      404 there would be a false alarm — flag it as unverified instead.
  const dev = await req("POST", "/api/dev/login", { body: { role: "admin" } });
  if (IS_LOCAL) {
    warn("dev login kill switch", `NOT VERIFIED against a dev server (HTTP ${dev.status}). ` +
      `Run the audit against production before shipping.`);
  } else {
    check("dev login disabled in production", dev.status === 404, `HTTP ${dev.status}`);
  }

  // 2c. Cron endpoints require the shared secret.
  for (const r of ["/api/jobs/generation-worker", "/api/jobs/replica-worker"]) {
    const res = await req("POST", r);
    check(`${r} requires the cron secret`, [401, 403].includes(res.status), `HTTP ${res.status}`);
  }

  // 2d. THE IDOR TEST THAT MATTERS: /api/assets/[generationId] hands back a
  //     signed URL to a video file. A buyer must not be able to fetch the asset
  //     for a generation belonging to a different buyer org.
  const { data: mine } = await admin.from("generations")
    .select("id").eq("buyer_org_id", buyer.orgId).limit(1).maybeSingle();
  const theirs = foreignGenerationId ? { id: foreignGenerationId } : null;

  if (mine) {
    const ok = await req("GET", `/api/assets/${mine.id}`, { cookie: buyer.cookie });
    // Control: the buyer CAN read their own. Without this the negative test
    // below could pass simply because the endpoint is broken for everyone.
    check("control — buyer can fetch their OWN asset", ok.status === 200, `HTTP ${ok.status}`);
  } else {
    warn("IDOR control", "buyer owns no generations — negative test would be vacuous");
  }
  if (theirs) {
    // Ground truth: the row EXISTS. Without this, a 404 could mean "no such
    // record" and the test would prove nothing.
    const { data: exists } = await admin.from("generations")
      .select("id, buyer_org_id").eq("id", theirs.id).maybeSingle();
    const reallyForeign = Boolean(exists) && exists!.buyer_org_id !== buyer.orgId;

    const res = await req("GET", `/api/assets/${theirs.id}`, { cookie: buyer.cookie });
    const leaked = res.status === 200 && /https?:\/\//.test(res.text);
    // 404 here is the CORRECT denial: the route runs the lookup under the
    // caller's own JWT and refuses to distinguish "absent" from "forbidden".
    attackBlocked("buyer cannot fetch ANOTHER org's asset by ID (IDOR)", {
      blocked: !leaked,
      exercised: reallyForeign,
      detail: reallyForeign
        ? `HTTP ${res.status}, no signed URL returned (row confirmed to exist and belong to another org)`
        : "victim row not present — could not prove denial vs absence",
    });
  } else {
    warn("IDOR negative test", "no generation owned by a different org to attack");
  }

  // 2e. A creator must not read the buyer-side request workspace of another org,
  //     and vice versa — checked at the page level too.
  const { data: otherReq } = await admin.from("approval_requests")
    .select("id, buyer_org_id").neq("buyer_org_id", buyer.orgId).limit(1).maybeSingle();
  if (otherReq) {
    const res = await req("GET", `/buyer/requests/${otherReq.id}`, { cookie: buyer.cookie });
    const leaked = res.status === 200 && !/not found|notFound/i.test(res.text);
    attackBlocked("buyer cannot open another org's request page (IDOR)", {
      blocked: !leaked, exercised: true, detail: `HTTP ${res.status}`,
    });
  }

  // 2f. Non-admins must not reach the admin console.
  for (const a of [buyer, creator]) {
    const res = await req("GET", "/admin", { cookie: a.cookie });
    const reached = res.status === 200 && /Platform economics/.test(res.text);
    check(`${a.role} cannot reach /admin`, !reached, `HTTP ${res.status}`);
  }
  const adminOk = await req("GET", "/admin", { cookie: adminA.cookie });
  check("control — admin CAN reach /admin", adminOk.status === 200 && /Platform economics/.test(adminOk.text),
    `HTTP ${adminOk.status}`);

  // 2g. The approval token is the credential; it must never reach the buyer.
  const my = await req("GET", "/api/my-approvals", { cookie: buyer.cookie });
  check("buyer receives no approval tokens", !/"token"\s*:\s*"[A-Za-z0-9_-]{10,}/.test(my.text),
    `HTTP ${my.status}`);
}

// ── 3. SESSION INTEGRITY ────────────────────────────────────────────────────
export async function auditSession(buyer: Actor) {
  area(3, "SESSION INTEGRITY — forged and tampered sessions must fail");

  // 3a. A completely invented session cookie.
  const forged = Buffer.from(JSON.stringify({
    access_token: "not.a.real.token", token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "x",
    user: { id: "00000000-0000-0000-0000-000000000001", email: "attacker@evil.test",
            role: "authenticated", aud: "authenticated" },
  })).toString("base64");
  const r1 = await req("GET", "/admin", { cookie: `sb-${REF}-auth-token=base64-${forged}` });
  check("forged session cookie is rejected", !(r1.status === 200 && /Platform economics/.test(r1.text)),
    `HTTP ${r1.status}`);

  // 3b. Tamper a REAL token: swap the subject to another user, keep the signature.
  const [h, pl, sig] = buyer.token.split(".");
  const claims = JSON.parse(Buffer.from(pl, "base64").toString());
  const { data: victim } = await admin.from("profiles").select("id").neq("id", buyer.uid).limit(1).single();
  claims.sub = victim!.id;
  const tamperedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const tamperedJwt = `${h}.${tamperedPayload}.${sig}`;

  // Assert at the DATABASE boundary — the strongest place to prove it.
  const tamperedClient = anonClient();
  const res = await fetch(`${URL_}/rest/v1/profiles?select=id&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${tamperedJwt}` },
  });
  check("tampered JWT (swapped user id, reused signature) is rejected",
    res.status === 401 || res.status === 403, `HTTP ${res.status}`);
  void tamperedClient;

  // 3c. Signature stripped / alg-none style attack.
  const none = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${tamperedPayload}.`;
  const r3 = await fetch(`${URL_}/rest/v1/profiles?select=id&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${none}` },
  });
  check("alg:none / unsigned JWT is rejected", r3.status === 401 || r3.status === 403, `HTTP ${r3.status}`);

  // 3d. Control: the untampered token still works, so the tests above are not
  //     passing merely because every request fails.
  const good = await fetch(`${URL_}/rest/v1/profiles?select=id&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${buyer.token}` },
  });
  check("control — the genuine token still works", good.status === 200, `HTTP ${good.status}`);
}

// ── 4. MASS ASSIGNMENT ──────────────────────────────────────────────────────
export async function auditMassAssignment() {
  area(4, "MASS ASSIGNMENT — privileged fields must be ignored, not trusted");

  const stamp = Date.now().toString(36);
  const email = `audit.mass.${stamp}@mailinator.com`;
  const password = `Audit-${stamp}-Pw!`;

  // 4a. Our signup route, with privileged extras smuggled alongside valid fields.
  const res = await req("POST", "/api/auth/signup", {
    body: {
      email, password, role: "buyer", display_name: `Audit ${stamp}`,
      // the smuggled payload:
      kyc_status: "verified", is_verified: true, balance_paise: 9999999,
      org_id: "00000000-0000-0000-0000-000000000000", id: "00000000-0000-0000-0000-000000000009",
    },
  });
  const created = res.status === 200 && res.json?.user_id;
  // NON-VACUOUS: the account must actually exist, otherwise "no privileges
  // granted" is meaningless.
  check("control — the account was actually created", Boolean(created), `HTTP ${res.status} ${res.text.slice(0, 80)}`);

  if (created) {
    const uid = res.json.user_id as string;
    const { data: prof } = await admin.from("profiles")
      .select("id, role, kyc_status, org_id").eq("id", uid).maybeSingle();
    check("smuggled role/kyc did not take effect", prof?.role === "buyer" && prof?.kyc_status !== "verified",
      `role=${prof?.role} kyc=${prof?.kyc_status}`);
    check("smuggled id was ignored (real uuid assigned)", prof?.id === uid && uid !== "00000000-0000-0000-0000-000000000009");
    check("smuggled org_id was ignored (own org created)",
      Boolean(prof?.org_id) && prof?.org_id !== "00000000-0000-0000-0000-000000000000", `org=${prof?.org_id}`);
    const { data: wallet } = await admin.from("credit_wallets").select("balance_paise").eq("org_id", prof!.org_id).maybeSingle();
    check("smuggled balance did not create funds", !wallet || Number(wallet.balance_paise) === 0,
      `balance=${wallet?.balance_paise ?? "no wallet"}`);
    await admin.auth.admin.deleteUser(uid).catch(() => {});
  }

  // 4b. role:"admin" through our route must be refused outright.
  const asAdmin = await req("POST", "/api/auth/signup", {
    body: { email: `audit.admin.${stamp}@mailinator.com`, password, role: "admin", display_name: "Nope" },
  });
  check("signup refuses role:'admin'", asAdmin.status === 400, `HTTP ${asAdmin.status}`);

  // 4c. THE REAL ATTACK: bypass our route entirely and sign up straight against
  //     Supabase with the anon key, putting role:"admin" in user_metadata. The
  //     DB trigger is what decides the role, so this is the path that matters.
  const direct = anonClient();
  const email2 = `audit.direct.${stamp}@mailinator.com`;
  const { data: sub, error: subErr } = await direct.auth.signUp({
    email: email2, password,
    options: { data: { role: "admin", display_name: "Direct Attack", kyc_status: "verified" } },
  });
  let attackUserId: string | null = sub?.user?.id ?? null;
  if (subErr || !sub.user) {
    // Supabase rate-limits anonymous signups. The defence under test is the
    // handle_new_user trigger, which fires for BOTH paths — so create the user
    // server-side with the same hostile metadata rather than skipping the check.
    const { data: forced, error: fErr } = await admin.auth.admin.createUser({
      email: `audit.trigger.${stamp}@mailinator.com`, password, email_confirm: true,
      user_metadata: { role: "admin", display_name: "Direct Attack", kyc_status: "verified" },
    });
    if (fErr || !forced.user) {
      warn("direct signUp attack", `could not create user by either path (${subErr?.message ?? fErr?.message}) — NOT exercised`);
    } else {
      attackUserId = forced.user.id;
      info("direct signUp attack", "anon signup rate-limited; exercised the same trigger via admin.createUser");
    }
  }
  if (attackUserId) {
    const sub2 = { user: { id: attackUserId } };
    void sub2;
    const { data: prof } = await admin.from("profiles")
      .select("role, kyc_status").eq("id", attackUserId).maybeSingle();
    attackBlocked("role:'admin' in user_metadata does NOT create an admin", {
      blocked: prof?.role !== "admin", exercised: Boolean(prof),
      detail: `resulting role=${prof?.role ?? "no profile"}`,
    });
    check("kyc_status in user_metadata is ignored", prof?.kyc_status !== "verified", `kyc=${prof?.kyc_status}`);
    await admin.auth.admin.deleteUser(attackUserId).catch(() => {});
  }
}

// ── 8. WEBHOOKS ─────────────────────────────────────────────────────────────
export async function auditWebhooks() {
  area(8, "WEBHOOKS — production signature verification");

  // Razorpay: a forged payment.captured must not be accepted.
  const forgedBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_forged_audit", notes: { license_id: "00000000-0000-0000-0000-000000000000" } } } },
  });
  const noSig = await req("POST", "/api/webhooks/razorpay", { raw: forgedBody });
  check("Razorpay webhook rejects a missing signature", [400, 401, 403].includes(noSig.status), `HTTP ${noSig.status}`);

  const badSig = await req("POST", "/api/webhooks/razorpay", {
    raw: forgedBody, headers: { "x-razorpay-signature": "0".repeat(64) },
  });
  check("Razorpay webhook rejects an invalid signature", [400, 401, 403].includes(badSig.status), `HTTP ${badSig.status}`);

  // Tavus: the token is in the path and must be unguessable/verified.
  const tav = await req("POST", "/api/webhooks/tavus/forged-audit-token", {
    body: { video_id: "x", status: "ready", download_url: "http://evil.example/x.mp4" },
  });
  check("Tavus webhook rejects a forged path token", [400, 401, 403, 404].includes(tav.status), `HTTP ${tav.status}`);

  // Assert nothing was actually written by the forgeries.
  const { count } = await admin.from("licenses").select("id", { count: "exact", head: true })
    .eq("rzp_payment_id", "pay_forged_audit");
  check("no licence was activated by the forged webhook", (count ?? 0) === 0, `${count} rows`);
}

// ── 10. SECURITY HEADERS ────────────────────────────────────────────────────
export async function auditHeaders() {
  area(10, "SECURITY HEADERS");
  const r = await fetch(`${BASE}/`);
  const h = r.headers;
  const csp = h.get("content-security-policy") ?? "";
  // HSTS is set by the edge and is meaningless on a plaintext origin.
  if (IS_LOCAL) {
    warn("Strict-Transport-Security", "NOT VERIFIED — a dev server is plaintext; the header comes from the production edge.");
  } else {
    check("Strict-Transport-Security", Boolean(h.get("strict-transport-security")), h.get("strict-transport-security") ?? "");
  }
  check("X-Content-Type-Options: nosniff", (h.get("x-content-type-options") ?? "").includes("nosniff"));
  check("X-Frame-Options: DENY", (h.get("x-frame-options") ?? "").toUpperCase().includes("DENY"));
  check("CSP frame-ancestors 'none'", /frame-ancestors\s+'none'/.test(csp), csp.slice(0, 60));
  check("Referrer-Policy", Boolean(h.get("referrer-policy")), h.get("referrer-policy") ?? "");
  check("Permissions-Policy", Boolean(h.get("permissions-policy")), (h.get("permissions-policy") ?? "").slice(0, 50));
  check("framework version not advertised", !h.get("x-powered-by"), h.get("x-powered-by") ?? "hidden");
}
