import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";

(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: gen } = await admin.from("generations").select("id, buyer_org_id")
    .eq("status", "delivered").order("created_at", { ascending: false }).limit(1).single();
  const { data: blob } = await admin.storage.from("deliverables").download(`${gen!.buyer_org_id}/${gen!.id}/final.mp4`);
  await writeFile("public/sample-verified.mp4", Buffer.from(await blob!.arrayBuffer()));
  console.log("sample saved, bytes:", blob!.size);
})().catch((e) => { console.error(e.message); process.exit(1); });
