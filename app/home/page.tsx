import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";


export const metadata = { title: "Home" };
// Profile-first entry: land every signed-in user on THEIR surface.
export default async function HomeRouter() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home");
  const { data: profile } = await supabase
    .from("profiles").select("role, handle").eq("id", user.id).single();
  if (!profile) redirect("/login");
  if (profile.role === "creator") redirect("/creator");
  if (profile.role === "admin") redirect("/admin");
  if (profile.role === "fan") redirect("/fan");
  redirect("/buyer");
}
