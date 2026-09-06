"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      <LogOut className="size-4" />
      Sign out
    </Button>
  );
}
