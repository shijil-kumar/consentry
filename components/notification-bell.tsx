"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Bell, Check } from "lucide-react";

interface Notif {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(15);
    if (data) setItems(data);
  }, []);

  useEffect(() => {
    let alive = true;
    const supabase = supabaseBrowser();
    const run = () => { if (alive) load(); };
    run();
    const ch = supabase
      .channel("notif-bell")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, run)
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [load]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const unread = items.filter((n) => !n.read_at).length;

  async function markAll() {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    await supabaseBrowser().from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    setItems((xs) => xs.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Panel width is viewport-aware: a fixed w-80 anchored to a bell near the
          right edge pushed ~130px of it off-screen on a phone, and an absolutely
          positioned overflow to the LEFT cannot be scrolled back into view. */}
      {open && (
        <div className="absolute right-0 top-10 z-50 w-[min(20rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Check className="size-3" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
            ) : (
              items.map((n) => {
                const inner = (
                  <div className={`border-b px-3 py-2.5 last:border-0 ${n.read_at ? "" : "bg-primary/5"}`}>
                    <div className="flex items-start gap-2">
                      {!n.read_at && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />}
                      <div className={n.read_at ? "pl-3.5" : ""}>
                        <p className="text-sm font-medium leading-snug">{n.title}</p>
                        {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {new Date(n.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
                return n.link ? (
                  <Link key={n.id} href={n.link} onClick={() => setOpen(false)} className="block hover:bg-muted/50">{inner}</Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
