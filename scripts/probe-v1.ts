import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: g } = await admin.from("generations").select("id").eq("status", "delivered").limit(1).single();
  const r = await fetch("http://localhost:3000/api/v1/verify/" + g!.id);
  console.log("v1/verify:", r.status, JSON.stringify(await r.json()).slice(0, 260));
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
