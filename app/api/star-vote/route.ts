import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Public star-request voting. Anonymous by design (fan-side demand capture);
// per-IP throttle keeps casual spam out — real dedupe is a post-funding item.
const hits = new Map<string, { n: number; t: number }>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > 10;
}

const Body = z.object({ name: z.string().trim().min(2).max(60) });

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (throttled(ip)) return Response.json({ error: "rate_limited" }, { status: 429 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch { return Response.json({ error: "invalid_name" }, { status: 400 }); }

  const { data, error } = await supabaseAdmin().rpc("vote_star", { p_name: body.name });
  if (error) return Response.json({ error: "vote_failed" }, { status: 400 });
  return Response.json({ ok: true, votes: data });
}
