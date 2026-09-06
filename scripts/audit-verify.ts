/**
 * B1.4 — audit chain verifier. `npm run audit:verify`
 * Recomputation happens INSIDE Postgres (verify_audit_chain(), migration 0002)
 * with the exact operators/serialization the writer used; this script just
 * invokes it with the service key and reports.
 */
import { config } from "dotenv";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: path.resolve(__dirname, "..", ".env.local") });

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await admin.rpc("verify_audit_chain");
  if (error) {
    console.error("verify_audit_chain failed:", error.message);
    process.exit(2);
  }
  const row = Array.isArray(data) ? data[0] : data;
  console.log(`audit_log rows: ${row.total}  |  bad: ${row.bad}` +
    (row.first_bad_id ? `  |  first bad id: ${row.first_bad_id}` : ""));
  if (Number(row.bad) > 0) {
    console.error("AUDIT CHAIN BROKEN — investigate immediately.");
    process.exit(1);
  }
  console.log("Audit chain intact: every row hash and link verified.");
}

main();
