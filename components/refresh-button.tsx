"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

// Re-runs a server component's data fetch without a full page reload. Kept as
// its own client island so the panel around it can stay a server component.
export function RefreshButton({ label, className }: { label: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      {pending ? "Checking…" : label}
    </Button>
  );
}
