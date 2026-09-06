import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export interface Profile {
  id: string;
  org_id: string;
  role: "creator" | "buyer" | "admin" | "fan";
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
}

// Server-component guard: session + profile + (optional) role. Optimistic UX —
// RLS remains the real authority for every query the page then runs.
export async function requireProfile(role?: Profile["role"]) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, org_id, role, display_name, handle, avatar_url")
    .eq("id", user.id)
    .single<Profile>();
  if (!profile) redirect("/login");

  if (role && profile.role !== role) {
    // Send them to THEIR home. (An admin hitting /buyer used to bounce to
    // /buyer again — infinite redirect.)
    redirect(profile.role === "creator" ? "/creator" : profile.role === "admin" ? "/admin" : profile.role === "fan" ? "/fan" : "/buyer");
  }
  return { supabase, user, profile };
}
