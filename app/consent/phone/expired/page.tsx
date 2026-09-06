import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Link no longer valid" };

// Shown when a scanned consent-handoff QR is expired or already used. Kept
// deliberately reassuring: an expired link is the system working, not an error
// the person did something wrong to cause.
export default async function ConsentHandoffExpired({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const used = reason === "used";

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <ShieldAlert className="size-10 text-amber-500" />
      <h1 className="text-xl font-semibold tracking-tight">
        {used ? "This code was already used" : "This code has expired"}
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {used
          ? "Each code works once — that's deliberate, so a screenshot of your QR can never be reused by someone else."
          : "Codes last 20 minutes for your protection."}
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        On your computer, open <span className="font-medium text-foreground">Record your consent</span> and
        tap <span className="font-medium text-foreground">Record on my phone</span>
        {" "}(or <span className="font-medium text-foreground">Get a fresh code</span>, if a code is
        already showing). Then scan the new code.
      </p>
      <Button render={<Link href="/creator/consent" />} nativeButton={false} variant="outline" className="mt-1">
        Open it on this device instead
      </Button>
    </main>
  );
}
