"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldAlert, Clock, Check, X } from "lucide-react";

export interface ReportRow {
  id: string;
  category: string;
  detail: string;
  status: string;
  sla_deadline: string;
  created_at: string;
  generation_id: string | null;
  reporter_email: string | null;
}

const CAT_LABEL: Record<string, string> = {
  impersonation: "Impersonation", non_consensual: "Non-consensual",
  ip_infringement: "IP", unlawful_content: "Unlawful", other: "Other",
};

function slaBadge(deadline: string, status: string) {
  if (status !== "open" && status !== "reviewing") {
    return <Badge variant="outline" className="capitalize">{status}</Badge>;
  }
  const msLeft = new Date(deadline).getTime() - Date.now();
  const overdue = msLeft < 0;
  const mins = Math.round(Math.abs(msLeft) / 60000);
  const label = overdue ? `${mins}m overdue` : `${Math.floor(mins / 60)}h ${mins % 60}m left`;
  return (
    <Badge variant="outline" className={overdue
      ? "border-red-500/40 bg-red-500/10 text-red-600"
      : mins < 60 ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
      : "border-zinc-500/30 text-muted-foreground"}>
      <Clock className="size-3" /> {label}
    </Badge>
  );
}

export function TakedownQueue({ reports }: { reports: ReportRow[] }) {
  const router = useRouter();
  const [items, setItems] = useState(reports);
  const [busy, setBusy] = useState<string | null>(null);

  async function resolve(id: string, status: "actioned" | "dismissed") {
    setBusy(id);
    // service_role-only RPC → route through the admin API
    const res = await fetch("/api/admin/resolve-report", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ report_id: id, status }),
    });
    setBusy(null);
    if (res.ok) {
      setItems((xs) => xs.map((r) => (r.id === id ? { ...r, status } : r)));
      router.refresh();
    }
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No reports. All content is in good standing.</p>;
  }

  return (
    <div className="grid gap-3">
      {items.map((r) => (
        <div key={r.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-amber-500" />
              <Badge variant="outline">{CAT_LABEL[r.category] ?? r.category}</Badge>
              {slaBadge(r.sla_deadline, r.status)}
            </div>
            <span className="text-xs text-muted-foreground">
              {new Date(r.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <p className="mt-2 text-sm">{r.detail}</p>
          {r.reporter_email && <p className="mt-0.5 text-xs text-muted-foreground">Reporter: {r.reporter_email}</p>}
          {(r.status === "open" || r.status === "reviewing") && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => resolve(r.id, "actioned")} disabled={busy === r.id}>
                {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Action (take down)
              </Button>
              <Button size="sm" variant="outline" onClick={() => resolve(r.id, "dismissed")} disabled={busy === r.id}>
                <X className="size-4" /> Dismiss
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
