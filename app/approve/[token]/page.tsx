import { ApprovalCard } from "@/components/approval-card";
import { LogoMark } from "@/components/logo";

export const metadata = { title: "Review & approve" };

// Magic-link approval screen. No login: the single-use token in the URL is the
// credential, so it opens anywhere the celebrity already is — phone, laptop, or
// tablet. It was previously locked to max-w-md, which is a phone-width column;
// on a desktop monitor that read as a cramped strip and made the whole product
// feel phone-only. The width now scales, while staying comfortable on a phone.
export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <header className="mx-auto flex h-14 max-w-md items-center gap-2 px-4 font-semibold tracking-tight sm:max-w-2xl">
        <LogoMark className="size-7" /> {process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Platform"}
        <span className="ml-auto rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
          Secure review link
        </span>
      </header>
      <main className="mx-auto max-w-md px-4 pb-16 sm:max-w-2xl">
        <ApprovalCard token={token} />
      </main>
    </div>
  );
}
