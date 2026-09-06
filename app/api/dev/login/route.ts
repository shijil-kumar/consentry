import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

export const maxDuration = 15;

// DEV-ONLY frictionless login. Gated by DEV_OPEN=1 — returns 404 otherwise, so
// it cannot exist in a go-live build. It does a REAL password sign-in as a
// seeded demo account (so RLS + the gate stay fully in force — this is not a
// security bypass, just a zero-typing convenience). At go-live: set DEV_OPEN=0
// and the normal /login flow is the only way in.
const DEMO: Record<string, string> = {
  creator: "arjun@consentfirst.test",
  brand: "brand@consentfirst.test",
  fan: "fan@consentfirst.test",
  admin: "admin@consentfirst.test",
};
const Body = z.object({ role: z.enum(["creator", "brand", "fan", "admin"]) });

function devOpen(): boolean {
  // Belt-and-suspenders: NEVER honor DEV_OPEN in a production build, even if the
  // env var leaks. The dev switcher can only exist in dev/preview builds.
  return process.env.DEV_OPEN === "1" && process.env.NODE_ENV !== "production";
}

export async function POST(req: Request) {
  if (!devOpen()) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const password = process.env.DEMO_PASSWORD;
  if (!password) {
    return Response.json({ error: "DEMO_PASSWORD not set" }, { status: 500 });
  }
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const email = DEMO[body.role];
  const supabase = await supabaseServer(); // cookie-writing SSR client
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return Response.json(
      { error: error.message, hint: "run `npm run seed:demo` to create the demo accounts" },
      { status: 400 },
    );
  }
  const dest = body.role === "creator" ? "/creator" : body.role === "admin" ? "/admin" : body.role === "fan" ? "/fan" : "/buyer";
  return Response.json({ ok: true, email, dest });
}
