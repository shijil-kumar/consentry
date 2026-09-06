// Prints one-click sign-in links for the demo roles, so a rehearsal (or the demo
// itself) never needs a password typed into a form. Not shipped.
//   npx tsx scripts/probe-magiclink.ts creator|admin|buyer|fan [path]
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const role = process.argv[2] ?? "creator";
const dest = process.argv[3] ?? "/";
const BASE = process.env.PROBE_BASE ?? "https://consentry.app";

(async () => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  // @arjun is the creator the whole demo is built around; other creators are
  // seeded placeholders with no consent record or deliveries behind them.
  const q = admin.from("profiles").select("id, handle, role").eq("role", role);
  const { data: rows } = role === "creator" ? await q.eq("handle", "arjun") : await q.limit(1);
  const prof = rows?.[0];
  if (!prof) throw new Error(`no profile with role=${role}`);
  const { data: u } = await admin.auth.admin.getUserById(prof.id);
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: u.user!.email!,
    options: { redirectTo: `${BASE}${dest}` },
  });
  if (error) throw error;
  console.log(`${role} (${u.user!.email})\n${data.properties!.action_link}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
