"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

/**
 * The body of every route-segment error.tsx.
 *
 * One component rather than a dozen near-copies, so the recovery affordance is
 * the same everywhere: a real retry that re-runs the segment, plus a way out to
 * a page that is known to work. An error screen with only an apology leaves the
 * person stuck on it.
 *
 * `reset` is Next's segment re-render. It is genuinely useful for the common
 * case here -- a failed server fetch -- because retrying re-runs the server
 * component rather than just re-mounting a broken client tree.
 *
 * The reassurance in the copy is load-bearing and it is true: every state
 * change in this product is a database write behind a SECURITY DEFINER
 * function. A page that fails to render cannot have altered a consent record,
 * a licence or a payment, and telling someone that is the difference between a
 * scary screen and a survivable one.
 */
export function RouteError({
  error,
  reset,
  what,
  backHref = "/",
  backLabel = "Go to the home page",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** Plain-language name of what failed, e.g. "your campaign". */
  what: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight">
        We could not load {what}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        This is a failure to display, not a change to your data. Consent records,
        licences and payments are written by the database and are unaffected by a
        page that fails to render.
      </p>
      {error.digest && (
        <p className="mt-3 text-xs text-muted-foreground">
          Reference <code className="font-mono">{error.digest}</code>
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </Button>
        <Button variant="outline" render={<Link href={backHref} />} nativeButton={false}>
          {backLabel}
        </Button>
      </div>
    </div>
  );
}
