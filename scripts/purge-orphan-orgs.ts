/* eslint-disable @typescript-eslint/no-explicit-any */
// Remove organisations that nothing references.
//
// The automated suites create orgs on every run — "RLS A", "Stranger",
// "Direct Attack", "P34 Brand" and friends — and never delete them. By
// 2026-08-21 that had accumulated to 631 of 650 orgs, so the admin console
// reported "650 Organisations" when 19 were real.
//
// That is worse than untidy. Shown to an investor, an inflated org count reads
// as traction the product does not have, and nobody in the room can tell the
// difference. The number on the console has to be true.
//
// The guard is deliberately strict: a single trace of real activity — a member,
// listing, licence, generation, consent record, avatar or ledger entry — keeps
// the row. Dry-run by default.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const APPLY = process.argv.includes("--apply");

/** Org ids that are referenced by anything at all. */
async function referencedOrgIds(): Promise<Set<string>> {
  const keep = new Set<string>();
  const add = (rows: any[] | null, ...cols: string[]) => {
    for (const r of rows ?? []) for (const c of cols) if (r[c]) keep.add(r[c]);
  };
  add((await admin.from("profiles").select("org_id")).data, "org_id");
  add((await admin.from("listings").select("org_id")).data, "org_id");
  add((await admin.from("licenses").select("buyer_org_id, creator_org_id")).data,
    "buyer_org_id", "creator_org_id");
  add((await admin.from("generations").select("buyer_org_id, creator_org_id")).data,
    "buyer_org_id", "creator_org_id");
  add((await admin.from("consent_records").select("org_id")).data, "org_id");
  add((await admin.from("avatars").select("org_id")).data, "org_id");
  add((await admin.from("credit_ledger").select("org_id")).data, "org_id");
  return keep;
}

export async function findOrphanOrgs(): Promise<Array<{ id: string; name: string }>> {
  const keep = await referencedOrgIds();
  const { data: orgs } = await admin.from("orgs").select("id, name");
  return (orgs ?? []).filter((o: any) => !keep.has(o.id));
}

if (process.argv[1]?.includes("purge-orphan-orgs")) {
  (async () => {
    const orphans = await findOrphanOrgs();
    const { count: total } = await admin.from("orgs").select("id", { count: "exact", head: true });
    console.log(`organisations:  ${total}`);
    console.log(`orphaned:       ${orphans.length}`);
    console.log(`real:           ${(total ?? 0) - orphans.length}`);
    if (!orphans.length) return console.log("nothing to purge");
    if (!APPLY) {
      console.log("\nDRY RUN — re-run with --apply to delete. First few:");
      orphans.slice(0, 6).forEach((o) => console.log(`  ${o.name}`));
      return;
    }
    const ids = orphans.map((o) => o.id);
    let removed = 0;
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      // A test signup leaves a welcome notification, which is itself only a
      // reference to the dead org. Same for an untouched wallet row.
      await admin.from("notifications").delete().in("org_id", batch);
      await admin.from("credit_wallets").delete().in("org_id", batch);
      const { error } = await admin.from("orgs").delete().in("id", batch);
      if (error) console.log(`  batch ${i}: ${error.message}`);
      else removed += batch.length;
    }
    console.log(`\nremoved ${removed} orphaned organisation(s)`);
  })();
}
