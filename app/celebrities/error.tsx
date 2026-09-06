"use client";

import { RouteError } from "@/components/route-error";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      what="the directory"
      backHref="/"
      backLabel="Go to the home page"
    />
  );
}
