// Rehearsal helper: stage a fresh demo on a deployed environment exactly the way
// the in-app admin button does (same endpoint, same real session), so what gets
// tested is what gets demoed. Not shipped — .vercelignore drops scripts/probe-*.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const { data: prof } = await admin.from("profiles").select("id").eq("role", "admin").limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(url, anon, { auth: { persistSession: false } });
  const { data: sess, error } = await pub.auth.verifyOtp({
    token_hash: link.properties!.hashed_token, type: "magiclink",
  });
  if (error) throw error;

  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/demo/reset`, {
    method: "POST", headers: { authorization: `Bearer ${sess.session!.access_token}` },
  });
  const j = await res.json();
  console.log(`HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(JSON.stringify(j, null, 1));
})().catch((e) => { console.error(e.message); process.exit(1); });
