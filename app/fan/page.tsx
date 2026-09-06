import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { WelcomeBand } from "@/components/dashboard/welcome-band";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Users, Search, ScanSearch, ArrowRight } from "lucide-react";


export const metadata = { title: "Following" };
export const dynamic = "force-dynamic";

// Fan home: a VIEW, not a product — followed celebrities + their authorised
// content (plain chronological; deliberately no ranking, comments, or DMs).
export default async function FanHome() {
  const { supabase, user, profile } = await requireProfile("fan");

  const { data: follows } = await supabase
    .from("follows").select("celebrity_id").eq("follower_id", user.id);
  const followedIds = (follows ?? []).map((f) => f.celebrity_id);

  const { data: registry } = await supabase
    .from("public_registry").select("*").order("delivered_at", { ascending: false }).limit(30);
  const feed = (registry ?? []).filter((r) => followedIds.includes(r.creator_id));

  const { data: listings } = await supabase
    .from("public_listings").select("handle, display_name");
  const nameByHandle = new Map((listings ?? []).map((l) => [l.handle, l.display_name]));

  return (
    <AppShell role="fan" displayName={profile.display_name}>
      <WelcomeBand name={profile.display_name}
        blurb="Follow verified stars and see every video they actually approved — nothing else is real." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-primary" /> From stars you follow
            </CardTitle>
            <CardDescription>Chronological, authorised content only — straight from the registry.</CardDescription>
          </CardHeader>
          <CardContent>
            {feed.length > 0 ? (
              <ul className="divide-y">
                {feed.map((g) => (
                  <li key={g.generation_id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {nameByHandle.get(g.handle) ?? g.handle} × {g.buyer_org_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Approved {new Date(g.delivered_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · provenance sealed
                      </p>
                    </div>
                    <Button render={<Link href={`/verify/${g.generation_id}`} />} nativeButton={false} size="sm" variant="outline">
                      Verify <ArrowRight className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <Users className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">You&apos;re not following anyone yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Follow a verified star to see their authorised content here.</p>
                <Button render={<Link href="/celebrities" />} nativeButton={false} className="mt-4">
                  <Search className="size-4" /> Browse the registry
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ScanSearch className="size-4 text-primary" /> Seen a video? Verify it.
              </CardTitle>
              <CardDescription>Drop any clip on the scanner — if a star approved it, it&apos;ll say so.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button render={<Link href="/inspect" />} nativeButton={false} variant="outline" className="w-full">
                Open the verifier
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Want a star protected?</CardTitle>
              <CardDescription>Vote for who we should verify next.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button render={<Link href="/request-a-star" />} nativeButton={false} variant="outline" className="w-full">
                Request a star
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
