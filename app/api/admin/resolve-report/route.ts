import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseForRequest } from "@/lib/supabase/server";

export const maxDuration = 15;

// Admin-only: resolve a takedown report. The caller must be an admin (checked
// via their JWT-bound client); resolve_report is a service_role RPC, and
// 'actioned' also disables the reported video so the /verify page reflects it.
const Body = z.object({
  report_id: z.string().uuid(),
  status: z.enum(["reviewing", "actioned", "dismissed"]),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const supabase = await supabaseForRequest(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "admin_only" }, { status: 403 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin.rpc("resolve_report", {
    p_report_id: body.report_id, p_status: body.status, p_note: body.note ?? null,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });

  // 'actioned' → take the video down (mark blocked so verify + playback reflect it)
  if (body.status === "actioned") {
    const { data: rep } = await admin.from("reports").select("generation_id").eq("id", body.report_id).single();
    if (rep?.generation_id) {
      await admin.from("generations").update({ status: "blocked", error: "taken_down" }).eq("id", rep.generation_id);
    }
  }
  return Response.json({ ok: true });
}
