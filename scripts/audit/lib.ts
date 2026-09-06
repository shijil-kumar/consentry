/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared machinery for the pre-deploy audit suite.
//
// Design rules this file exists to enforce:
//   • Assert against the DATABASE, not UI copy. A page can say anything.
//   • Every attack must EXERCISE the code path. A request that 400s on a wrong
//     field name proves nothing, so `exercised()` makes a test declare that the
//     handler actually ran before its result is trusted.
//   • Real attacks with real sessions minted from the anon key — never the
//     service role, which would bypass the very controls under test.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** True when auditing a dev server rather than the deployed site. A few checks
 *  (HSTS, the dev-login kill switch) can only be answered by the production
 *  edge; against localhost they are unanswerable, and reporting them as
 *  failures would train everyone to ignore the failure list. They are raised as
 *  warnings naming exactly what went unverified instead. */
export const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(
  process.env.AUDIT_BASE ?? process.env.PROBE_BASE ?? "");

export const BASE = process.env.AUDIT_BASE ?? process.env.PROBE_BASE ?? "https://consentry.app";
export const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const REF = new URL(URL_).hostname.split(".")[0];

/** Service-role client. ONLY for setting up fixtures and reading ground truth —
 *  never for performing an attack, since it bypasses RLS by design. */
export const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

// ── result collection ───────────────────────────────────────────────────────
export type Status = "PASS" | "FAIL" | "WARN" | "INFO";
export interface Result {
  area: string; name: string; status: Status; detail: string;
}
const results: Result[] = [];
let currentArea = "";

export function area(n: number, title: string) {
  currentArea = `${String(n).padStart(2, "0")} ${title}`;
  console.log(`\n\x1b[1m═══ ${currentArea} ═══\x1b[0m`);
}

function push(status: Status, name: string, detail: string) {
  results.push({ area: currentArea, name, status, detail });
  const colour = status === "PASS" ? "\x1b[32m" : status === "FAIL" ? "\x1b[31m"
    : status === "WARN" ? "\x1b[33m" : "\x1b[36m";
  console.log(`  ${colour}${status.padEnd(4)}\x1b[0m ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
}

export const pass = (name: string, detail = "") => push("PASS", name, detail);
export const fail = (name: string, detail = "") => push("FAIL", name, detail);
export const warn = (name: string, detail = "") => push("WARN", name, detail);
export const info = (name: string, detail = "") => push("INFO", name, detail);

/** Assert a condition, phrased so PASS always means "the app is safe". */
export function check(name: string, ok: boolean, detail = "") {
  (ok ? pass : fail)(name, detail);
  return ok;
}

/** A test whose ATTACK must be refused. Also records whether the code path was
 *  genuinely reached, because a schema rejection is not proof of authorisation. */
export function attackBlocked(name: string, opts: {
  blocked: boolean; exercised: boolean; detail?: string;
}) {
  if (!opts.exercised) {
    warn(name, `NOT EXERCISED — ${opts.detail ?? "request never reached the logic"}`);
    return false;
  }
  return check(name, opts.blocked, opts.detail ?? "");
}

export function summary(): number {
  const f = results.filter((r) => r.status === "FAIL");
  const w = results.filter((r) => r.status === "WARN");
  const p = results.filter((r) => r.status === "PASS");
  console.log(`\n${"═".repeat(72)}`);
  console.log(`\x1b[1mPASS ${p.length}   FAIL ${f.length}   WARN ${w.length}\x1b[0m`);
  if (f.length) {
    console.log(`\n\x1b[31mFAILURES\x1b[0m`);
    f.forEach((r) => console.log(`  [${r.area}] ${r.name} — ${r.detail}`));
  }
  if (w.length) {
    console.log(`\n\x1b[33mWARNINGS / NOT EXERCISED\x1b[0m`);
    w.forEach((r) => console.log(`  [${r.area}] ${r.name} — ${r.detail}`));
  }
  return f.length;
}

// ── real sessions (anon key, exactly like a browser) ────────────────────────
export interface Actor {
  client: SupabaseClient; token: string; cookie: string;
  uid: string; orgId: string; role: string; email: string;
}

export async function actorFor(role: string): Promise<Actor> {
  const { data: prof, error: pe } = await admin
    .from("profiles").select("id, org_id, role").eq("role", role).limit(1).single();
  if (pe) throw new Error(`no ${role} profile: ${pe.message}`);
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const email = u.user!.email!;
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: sess, error } = await pub.auth.verifyOtp({
    token_hash: link.properties!.hashed_token, type: "magiclink",
  });
  if (error) throw new Error(`session ${role}: ${error.message}`);
  const token = sess.session!.access_token;
  return {
    client: createClient(URL_, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }),
    token,
    cookie: `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(sess.session)).toString("base64")}`,
    uid: prof!.id, orgId: prof!.org_id, role: prof!.role, email,
  };
}

export const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false } });

// ── HTTP helpers ────────────────────────────────────────────────────────────
export async function req(method: string, p: string, opts: {
  cookie?: string; body?: unknown; headers?: Record<string, string>; raw?: string;
} = {}) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    redirect: "manual",
    headers: {
      ...(opts.body || opts.raw ? { "content-type": "application/json" } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, text, json, headers: r.headers };
}

/** True when the response shows the HANDLER ran rather than schema/auth bouncing
 *  us at the door. 400 "invalid_body" means our payload shape was wrong — the
 *  test proved nothing and must be fixed, not counted as a pass. */
export function looksExercised(res: { status: number; json: any; text: string }) {
  if (res.status === 400 && /invalid_body|invalid_request|ZodError/i.test(res.text)) return false;
  if (res.status === 404 && /not_found/i.test(res.text)) return false;
  return true;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
