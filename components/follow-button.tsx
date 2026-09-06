"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { UserPlus, Check, Loader2 } from "lucide-react";

// Optimistic follow: count updates instantly, then reconciles. Signed-out
// visitors are routed to signup — the follow is the fan-side conversion.
export function FollowButton({ celebrityId, handle, initialFollowing, initialCount, signedIn }: {
  celebrityId: string;
  handle: string;
  initialFollowing: boolean;
  initialCount: number;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    // Send them back to THIS star's page after signup. `/c` alone is a 404, so
    // the fan-conversion path used to dead-end on a brand-new account.
    if (!signedIn) { router.push(`/signup?next=/c/${handle}`); return; }
    const next = !following;
    setFollowing(next); setCount((c) => c + (next ? 1 : -1)); setBusy(true);
    const supabase = supabaseBrowser();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(false); return; }
    const res = next
      ? await supabase.from("follows").insert({ follower_id: user.id, celebrity_id: celebrityId })
      : await supabase.from("follows").delete().eq("follower_id", user.id).eq("celebrity_id", celebrityId);
    if (res.error) { // reconcile on failure
      setFollowing(!next); setCount((c) => c + (next ? -1 : 1));
    }
    setBusy(false);
  }

  return (
    <button onClick={toggle} disabled={busy}
      className={`inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors ${
        following
          ? "border border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
          : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"}`}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : following ? <Check className="size-4" /> : <UserPlus className="size-4" />}
      {following ? "Following" : "Follow"}
      <span className={`ml-0.5 tabular-nums ${following ? "text-emerald-300" : "text-emerald-950/70"}`}>
        {count.toLocaleString("en-IN")}
      </span>
    </button>
  );
}
