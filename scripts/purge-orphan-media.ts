/* eslint-disable @typescript-eslint/no-explicit-any */
// Delete rendered files whose generation row no longer exists.
//
// Every demo run and every probe writes a preview + a final master to the
// deliverables bucket. Cleanup deleted the DATABASE rows and left the files, so
// storage grew unbounded — 413 MB of dead objects by 18 Aug, none of it
// reachable from any UI. That is both a cost and a reliability problem: uploads
// start failing as a project approaches its storage ceiling, and the first
// visible symptom is a video failing to render mid-demo.
//
// Deletes through the storage API (not SQL) so the object store and its
// metadata stay consistent. Dry-run by default.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const APPLY = process.argv.includes("--apply");

(async () => {
  const { data: live } = await admin.from("generations").select("id");
  const liveIds = new Set((live ?? []).map((g: any) => g.id));

  // Walk the bucket: <buyer_org>/<generation_id>/<file>
  const orphans: string[] = [];
  let keptFiles = 0;
  const { data: orgs } = await admin.storage.from("deliverables").list("", { limit: 1000 });
  for (const org of orgs ?? []) {
    const { data: gens } = await admin.storage.from("deliverables").list(org.name, { limit: 1000 });
    for (const gen of gens ?? []) {
      const { data: files } = await admin.storage
        .from("deliverables").list(`${org.name}/${gen.name}`, { limit: 100 });
      for (const f of files ?? []) {
        const key = `${org.name}/${gen.name}/${f.name}`;
        if (liveIds.has(gen.name)) keptFiles++;
        else orphans.push(key);
      }
    }
  }

  console.log(`live generations: ${liveIds.size}`);
  console.log(`files kept:       ${keptFiles}`);
  console.log(`orphaned files:   ${orphans.length}`);
  if (!orphans.length) return console.log("nothing to purge");
  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to delete. First few:");
    orphans.slice(0, 5).forEach((o) => console.log(`  ${o}`));
    return;
  }
  // Storage removes in batches; keep them modest so one bad key cannot sink all.
  let removed = 0;
  for (let i = 0; i < orphans.length; i += 50) {
    const batch = orphans.slice(i, i + 50);
    const { error } = await admin.storage.from("deliverables").remove(batch);
    if (error) console.log(`  batch ${i}: ${error.message}`);
    else removed += batch.length;
  }
  console.log(`\nremoved ${removed} orphaned file(s)`);
})();
