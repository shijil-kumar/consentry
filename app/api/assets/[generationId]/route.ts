import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseForRequest } from "@/lib/supabase/server";

export const maxDuration = 30;

// Sanctioned admin.ts importer (ARCHITECTURE §2 — the ONE user-facing
// exception). It mints a short-lived signed URL for a delivered video ONLY
// after an RLS-checked read proves the caller is a license party. The service
// client receives no client-controlled authority: the party check runs on the
// caller's JWT; if that returns nothing, no URL is minted.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ generationId: string }> },
) {
  const { generationId } = await params;
  const supabase = await supabaseForRequest(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  // RLS: gen_select_parties → only buyer/creator org (or admin) sees this row
  const { data: gen } = await supabase
    .from("generations")
    .select("id, status, output_path, preview_path")
    .eq("id", generationId)
    .maybeSingle();
  if (!gen) return Response.json({ error: "not_found_or_forbidden" }, { status: 404 });

  // Delivered → the sealed final. During review states → the WATERMARKED
  // preview only. The clean master path is never signed here in any state.
  let servePath: string | null = null;
  let kind: "final" | "preview" | null = null;
  if (gen.status === "delivered" && gen.output_path) {
    servePath = gen.output_path; kind = "final";
  } else if (
    ["celebrity_review", "changes_requested", "approved", "rejected"].includes(gen.status) &&
    gen.preview_path
  ) {
    servePath = gen.preview_path; kind = "preview";
  }
  if (!servePath) {
    return Response.json({ error: "not_ready", status: gen.status }, { status: 409 });
  }

  const { data: signed, error } = await supabaseAdmin()
    .storage.from("deliverables")
    .createSignedUrl(servePath, 600);
  if (error || !signed) {
    return Response.json({ error: "sign_failed" }, { status: 500 });
  }
  return Response.json({ url: signed.signedUrl, expires_in: 600, kind });
}
