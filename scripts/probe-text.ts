import { config } from "dotenv"; import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = new URL(SUPA).hostname.split(".")[0];
(async () => {
  const s = await (await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method:"POST",
    headers:{apikey:ANON,"content-type":"application/json"},
    body: JSON.stringify({ email: process.argv[2], password: process.env.DEMO_PASSWORD }) })).json();
  const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(s)).toString("base64")}`;
  const html = await (await fetch(`${BASE}${process.argv[3]}`, { headers:{cookie} })).text();
  const body = html.split(/<main[^>]*>/)[1]?.split("</main>")[0] ?? html;
  console.log(body.replace(/<script[\s\S]*?<\/script>/g,"").replace(/<style[\s\S]*?<\/style>/g,"")
    .replace(/<[^>]+>/g," ").replace(/&[a-z]+;/g," ").replace(/\s+/g," ").trim().slice(0, Number(process.argv[4] ?? 1200)));
})();
