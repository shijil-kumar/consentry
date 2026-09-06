import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Sanctioned admin.ts importer (see eslint.config.mjs): signup must create a
// CONFIRMED user without depending on Supabase's rate-limited built-in SMTP
// (2 emails/hour would wreck demos). This route takes no authority beyond
// creating the caller's own account; role is restricted to creator|buyer|fan —
// 'admin' is never self-assignable.
const Body = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(100),
  role: z.enum(["creator", "buyer", "fan"]),
  display_name: z.string().trim().min(2).max(60),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,30}$/)
    .optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return Response.json({ error: "invalid_body", detail: String(e) }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: {
      role: body.role,
      display_name: body.display_name,
      ...(body.handle ? { handle: body.handle } : {}),
    },
  });

  if (error) {
    const status = /already|exists|registered/i.test(error.message) ? 409 : 400;
    return Response.json({ error: error.message }, { status });
  }
  return Response.json({ ok: true, user_id: data.user?.id });
}
