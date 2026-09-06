/* eslint-disable @typescript-eslint/no-explicit-any */
// Instant preview, per engine — the thing you show on stage.
//
// The old picker had ONE "Instant demo" served by the mock engine, so an
// instant preview was always the same 16:9 clip regardless of which engine you
// were talking about. Now instant is a property of the REQUEST: pick Tavus or
// HeyGen, ask for instant, and get that engine's own most recent real render.
//
// What must hold for each engine:
//   · instant is accepted and lands in seconds, not minutes
//   · it is recorded as a replay of THAT engine, never as a live render
//   · the file that comes out has that engine's own SHAPE (16:9 vs 9:16),
//     which is the entire point — the two must look visibly different
//   · the AI label and Content Credentials are applied for real
//   · instant does NOT bypass consent: an engine the creator never trained on
//     is still refused
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { writeFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let fails = 0;
const ok = (l: string, p: boolean, d = "") => {
  if (!p) fails++;
  console.log(`  ${p ? "ok  " : "FAIL"}  ${l}${d ? "  " + d : ""}`);
};
const head = (t: string) => console.log(`\n=== ${t} ===`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secs = (t: number) => `${((Date.now() - t) / 1000).toFixed(0)}s`;

async function sessionFor(role: string) {
  const { data: prof } = await admin.from("profiles")
    .select("id, org_id, display_name").eq("role", role).limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s } = await pub.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  return { profile: prof!, token: s!.session!.access_token };
}
const asUser = (t: string) => createClient(URL_, ANON, {
  auth: { persistSession: false }, global: { headers: { authorization: `Bearer ${t}` } },
});

/** Real dimensions of a delivered file, so "16:9 vs 9:16" is measured. */
async function dimensions(bytes: Buffer): Promise<string> {
  const f = path.join(tmpdir(), `inst-${Math.random().toString(36).slice(2)}.mp4`);
  await writeFile(f, bytes);
  try {
    const ff = (await import("ffmpeg-static")).default as unknown as string;
    let out = "";
    try { await promisify(execFile)(ff, ["-i", f], { timeout: 30_000 }); }
    catch (e) { out = String((e as { stderr?: string }).stderr ?? ""); }
    return /,\s(\d{3,4}x\d{3,4})[\s,]/.exec(out)?.[1] ?? "unknown";
  } finally { await unlink(f).catch(() => {}); }
}

(async () => {
  const buyer = await sessionFor("buyer");
  const creator = await sessionFor("creator");

  const kick = () => fetch(`${BASE}/api/jobs/generation-worker`, {
    method: "POST", headers: { authorization: `Bearer ${buyer.token}` },
  }).catch(() => null);

  const { data: avatars } = await admin.from("avatars")
    .select("provider, org_id, status, consent_records!inner(status)")
    .eq("status", "ready").eq("consent_records.status", "verified")
    .in("provider", ["tavus", "heygen"]);
  const targets: Array<{ engine: "tavus" | "heygen"; listingId: string }> = [];
  for (const a of avatars ?? []) {
    const { data: l } = await admin.from("listings")
      .select("id").eq("org_id", (a as any).org_id).eq("status", "published").limit(1).maybeSingle();
    if (l) targets.push({ engine: (a as any).provider, listingId: (l as any).id });
  }
  ok("both engines are instant-previewable", targets.length === 2, targets.map((t) => t.engine).join(","));

  const cleanup: Array<() => Promise<void>> = [];
  const shapes: Record<string, string> = {};

  try {
    for (const { engine, listingId } of targets) {
      head(`${engine.toUpperCase()} — instant preview`);
      const { data: tier } = await admin.from("license_tiers")
        .select("id, price_paise").eq("listing_id", listingId).order("price_paise").limit(1).single();
      const { data: cats } = await admin.from("listings")
        .select("allowed_categories").eq("id", listingId).single();
      const price = Number((tier as any).price_paise);

      const gate: any = await (await fetch(`${BASE}/api/requests`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${buyer.token}` },
        body: JSON.stringify({
          listing_id: listingId, tier_id: (tier as any).id,
          category: (cats as any)?.allowed_categories?.[0] ?? "fitness",
          script: "I have been using the AeroFit band for a week now, and the design and the battery life have genuinely impressed me.",
        }),
      })).json();
      const requestId = gate.request_id;
      cleanup.push(async () => { await admin.from("approval_requests").delete().eq("id", requestId); });
      if (gate.outcome === "needs_review") {
        await asUser(creator.token).rpc("decide_request", { p_request_id: requestId, p_decision: "approved" });
      }

      const cli = asUser(buyer.token);
      const { data: w } = await admin.from("credit_wallets")
        .select("balance_paise").eq("org_id", buyer.profile.org_id).maybeSingle();
      const start = Number(w?.balance_paise ?? 0);
      if (start < price) {
        await admin.from("credit_wallets").upsert(
          { org_id: buyer.profile.org_id, balance_paise: start + price * 2 }, { onConflict: "org_id" });
        await admin.from("credit_ledger").insert({
          org_id: buyer.profile.org_id, delta_paise: price * 2, balance_after: start + price * 2,
          reason: "adjustment", ref: `probe-instant-topup-${engine}`,
        });
        cleanup.push(async () => { await admin.from("credit_ledger").delete().eq("ref", `probe-instant-topup-${engine}`); });
      }
      const { data: lic } = await cli.rpc("begin_checkout", { p_request_id: requestId });
      const licenseId = lic as string;
      cleanup.push(async () => {
        await admin.from("credit_ledger").delete().eq("ref", licenseId);
        await admin.from("licenses").delete().eq("id", licenseId);
      });
      await cli.rpc("pay_license_with_credits", { p_license_id: licenseId });

      const t0 = Date.now();
      const genRes = await fetch(`${BASE}/api/generations`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${buyer.token}` },
        body: JSON.stringify({ license_id: licenseId, engine, mode: "instant" }),
      });
      const genBody: any = await genRes.json();
      ok(`instant preview of ${engine} is accepted`, genRes.ok, `HTTP ${genRes.status} ${genBody.error ?? ""}`);
      const generationId = genBody.generation_id ?? genBody.id;
      if (!generationId) continue;
      cleanup.push(async () => {
        const dir = `${buyer.profile.org_id}/${generationId}`;
        const { data: files } = await admin.storage.from("deliverables").list(dir, { limit: 100 });
        const keys = (files ?? []).map((f: any) => `${dir}/${f.name}`);
        if (keys.length) await admin.storage.from("deliverables").remove(keys);
        await admin.from("approval_events").delete().eq("generation_id", generationId);
        await admin.from("approval_tokens").delete().eq("generation_id", generationId);
        await admin.from("generations").delete().eq("id", generationId);
      });

      let status = "";
      for (let i = 0; i < 30 && status !== "celebrity_review"; i++) {
        await kick();
        await sleep(3000);
        const { data: g } = await admin.from("generations")
          .select("status, error").eq("id", generationId).maybeSingle();
        status = g?.status ?? "";
        if (g?.error) { ok("instant render ran clean", false, g.error.slice(0, 100)); break; }
      }
      const toReview = secs(t0);
      ok("it reaches the celebrity", status === "celebrity_review", `${status} in ${toReview}`);
      // "Instant" has to actually feel instant next to a 2-4 minute render.
      ok("...and it is genuinely fast (under 60s)",
        (Date.now() - t0) < 60_000, toReview);

      const { data: g1 } = await admin.from("generations")
        .select("render_mode, provider, requested_mode").eq("id", generationId).maybeSingle();
      ok("recorded as a replay, not a live render", g1?.render_mode === "replay", String(g1?.render_mode));
      ok(`attributed to ${engine}`, g1?.provider === engine, String(g1?.provider));
      ok("the request records that instant was asked for", g1?.requested_mode === "instant");

      // Approve and deliver, then measure the SHAPE of what came out.
      const { data: tok } = await admin.from("approval_tokens")
        .select("token").eq("generation_id", generationId).is("used_at", null).maybeSingle();
      if (!tok?.token) { ok("approval link minted", false); continue; }
      await fetch(`${BASE}/api/approval/${tok.token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      let st = "";
      for (let i = 0; i < 25 && st !== "delivered"; i++) {
        await kick();
        await sleep(3000);
        const { data: g } = await admin.from("generations").select("status").eq("id", generationId).maybeSingle();
        st = g?.status ?? "";
      }
      ok("delivered", st === "delivered", `${st} · ${secs(t0)} total`);

      const { data: fin } = await admin.from("generations")
        .select("output_path, watermarked, c2pa_manifest").eq("id", generationId).maybeSingle();
      ok("visible AI label + Content Credentials still applied",
        fin?.watermarked === true && Boolean(fin?.c2pa_manifest));
      if (fin?.output_path) {
        const { data: dl } = await admin.storage.from("deliverables").download(fin.output_path);
        if (dl) {
          shapes[engine] = await dimensions(Buffer.from(await dl.arrayBuffer()));
          ok(`${engine} delivered its own frame shape`, shapes[engine] !== "unknown", shapes[engine]);
        }
      }
    }

    // The whole point: the two previews must not look like the same clip.
    head("the two engines are visibly different");
    ok("Tavus and HeyGen deliver different shapes",
      Boolean(shapes.tavus && shapes.heygen && shapes.tavus !== shapes.heygen),
      `tavus=${shapes.tavus ?? "?"}  heygen=${shapes.heygen ?? "?"}`);

    // Instant is a rendering shortcut, never a consent shortcut.
    head("instant is not a bypass");
    {
      const { data: lic } = await admin.from("licenses")
        .select("id").eq("buyer_org_id", buyer.profile.org_id).eq("status", "active").limit(1).maybeSingle();
      if (lic) {
        // Through the API, the zod enum rejects an unknown engine before the
        // database is reached. That is correct defence in depth but proves
        // nothing about the GATE, so hit the RPC directly as well.
        const r = await fetch(`${BASE}/api/generations`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${buyer.token}` },
          body: JSON.stringify({ license_id: (lic as any).id, engine: "did", mode: "instant" }),
        });
        ok("the API refuses an unknown engine before the DB is touched", !r.ok, `HTTP ${r.status}`);

        const cli = asUser(buyer.token);
        const direct = await cli.rpc("create_generation", {
          p_license_id: (lic as any).id, p_engine: "did", p_mode: "instant",
        });
        ok("the DATABASE gate refuses instant on an untrained engine",
          direct.error !== null, direct.error?.message?.slice(0, 60) ?? "NO ERROR — it was allowed");

        const noEngine = await cli.rpc("create_generation", {
          p_license_id: (lic as any).id, p_engine: null, p_mode: "instant",
        });
        ok("instant without naming an engine is refused",
          noEngine.error !== null, noEngine.error?.message?.slice(0, 60) ?? "NO ERROR");

        const badMode = await cli.rpc("create_generation", {
          p_license_id: (lic as any).id, p_engine: "tavus", p_mode: "free-please",
        });
        ok("an invented mode is refused",
          badMode.error !== null, badMode.error?.message?.slice(0, 60) ?? "NO ERROR");
      } else {
        ok("a licence exists to test the bypass against", false, "none");
      }
    }
  } finally {
    head("cleanup");
    for (const fn of cleanup.reverse()) await fn().catch(() => {});
    const { data: rest } = await admin.from("credit_ledger")
      .select("delta_paise").eq("org_id", buyer.profile.org_id);
    const sum = (rest ?? []).reduce((a: number, r: any) => a + Number(r.delta_paise), 0);
    await admin.from("credit_wallets").update({ balance_paise: sum }).eq("org_id", buyer.profile.org_id);
    console.log(`  wallet ${sum} (matches ledger)`);
  }

  console.log(fails ? `\n${fails} FAILURE(S)` : "\ninstant works per engine, and the two look different");
  process.exit(fails ? 1 : 0);
})();
