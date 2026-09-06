import Link from "next/link";
import { Fraunces } from "next/font/google";
import { supabaseServer } from "@/lib/supabase/server";
import { StarVoteList } from "@/components/star-vote-list";
import { PublicHeader } from "@/components/public-header";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", weight: ["400", "500", "600"] });
const display = "[font-family:var(--font-fraunces)]";

export const metadata = {
  title: "Request a star",
  description: "Vote for the celebrities you want protected and licensable next.",
};
export const dynamic = "force-dynamic";

export default async function RequestAStarPage() {
  const supabase = await supabaseServer();
  const { data: stars } = await supabase
    .from("star_requests").select("star_name, votes").order("votes", { ascending: false }).limit(20);

  return (
    <div className={`${fraunces.variable} min-h-dvh bg-zinc-950 text-zinc-100`}>
      <PublicHeader width="max-w-3xl">
        <Link href="/celebrities" className="text-zinc-300 hover:text-white">Directory</Link>
      </PublicHeader>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <p className="text-[13px] font-medium uppercase tracking-[0.2em] text-emerald-400">Request a star</p>
        <h1 className={`${display} mt-2 text-3xl font-medium tracking-tight sm:text-5xl`}>
          Whose likeness should we protect next?
        </h1>
        <p className="mt-4 max-w-xl text-zinc-300">
          We verify and onboard a limited number of celebrities at a time — identity checks and
          consent recording take real work. Your vote decides who&apos;s next, and shows them
          how many fans want their likeness protected.
        </p>
        <div className="mt-8">
          <StarVoteList initial={(stars ?? []).map((s) => ({ name: s.star_name, votes: s.votes }))} />
        </div>
        <p className="mt-8 text-xs text-zinc-500">
          Vote counts include demo sample data during the pilot. Voting is free and anonymous.
        </p>
      </main>
    </div>
  );
}
