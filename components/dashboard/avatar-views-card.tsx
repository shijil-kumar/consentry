import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Eye, Building2 } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";

// "Who viewed your avatar" — the celebrity's own view rows (RLS: own-select
// only). Seeded rows carry is_sample=true and the card labels them honestly.
export async function AvatarViewsCard() {
  const supabase = await supabaseServer();
  const { data: views } = await supabase
    .from("avatar_views")
    .select("viewer_label, viewed_at, is_sample")
    .order("viewed_at", { ascending: false })
    .limit(5);

  if (!views || views.length === 0) return null;
  const sample = views.some((v) => v.is_sample);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Eye className="size-4 text-primary" /> Who viewed your avatar
          {sample && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600">
              sample data
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {views.length} brand{views.length === 1 ? "" : "s"} looked at your listing this week.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2.5">
          {views.map((v, i) => (
            <li key={i} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <Building2 className="size-3.5 text-muted-foreground" /> {v.viewer_label}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(v.viewed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
