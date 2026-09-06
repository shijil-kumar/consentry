// Backfills generations.output_sha256 for deliveries made before the column
// existed. Without it the "scan a video" tool cannot identify them on hosts
// where the C2PA reader can't run (see 0021_output_fingerprint.sql) — including
// the bundled public/sample-verified.mp4 that the Scan-our-sample button uses.
// Idempotent: re-running only touches rows still missing a hash.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

(async () => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: rows, error } = await admin.from("generations")
    .select("id, output_path, output_sha256")
    .eq("status", "delivered").not("output_path", "is", null);
  if (error) throw error;

  let done = 0, skipped = 0, missing = 0;
  for (const g of rows ?? []) {
    if (g.output_sha256) { skipped++; continue; }
    const { data: blob } = await admin.storage.from("deliverables").download(g.output_path!);
    if (!blob) { missing++; console.warn(`  ! ${g.id}: object not found at ${g.output_path}`); continue; }
    const sha = createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex");
    const { error: uErr } = await admin.from("generations")
      .update({ output_sha256: sha }).eq("id", g.id);
    if (uErr) { console.warn(`  ! ${g.id}: ${uErr.message}`); continue; }
    console.log(`  · ${g.id} -> ${sha.slice(0, 16)}…`);
    done++;
  }
  console.log(`\nhashed ${done}, already had one ${skipped}, object missing ${missing}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
