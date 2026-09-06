"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ScrollText } from "lucide-react";

interface AuditRow { id: number; action: string; created_at: string }

const LABELS: Record<string, string> = {
  "consent.granted": "Consent granted",
  "consent.verified": "Consent verified",
  "consent.revoked": "Consent revoked",
  "avatar.ready": "Replica ready",
  "avatar.failed": "Replica failed",
  "request.auto_approved": "Script auto-approved",
  "request.rejected": "Script blocked",
  "request.needs_review": "Script sent to review",
  "request.approved_manual": "Script approved",
  "request.rejected_manual": "Script rejected",
  "license.payment_pending": "Checkout started",
  "license.activated": "License activated",
  "generation.queued": "Video queued",
  "generation.delivered": "Video delivered",
};

// B8.1 — LIVE audit feed. Supabase Realtime with a 5s poll fallback so the
// feed still moves if the socket drops.
export function LiveLedger({ initial }: { initial: AuditRow[] }) {
  const [rows, setRows] = useState<AuditRow[]>(initial);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let mounted = true;

    const poll = async () => {
      const { data } = await supabase.from("audit_log")
        .select("id, action, created_at").order("id", { ascending: false }).limit(12);
      if (mounted && data) setRows(data);
    };
    const interval = setInterval(poll, 5000);

    const channel = supabase
      .channel("audit-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_log" }, poll)
      .subscribe();

    return () => { mounted = false; clearInterval(interval); supabase.removeChannel(channel); };
  }, []);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Ledger entries appear as you act.</p>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <ScrollText className="size-3.5 text-muted-foreground" />
            {LABELS[r.action] ?? r.action}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {new Date(r.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </li>
      ))}
    </ul>
  );
}
