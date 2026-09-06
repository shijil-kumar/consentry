"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Clapperboard, Building2, ShieldCheck, Heart, LogOut, FlaskConical, Loader2 } from "lucide-react";

// Frictionless dev role-switcher. Only rendered when NEXT_PUBLIC_DEV_OPEN=1.
// One click = a real session as a seeded demo account (RLS stays in force).
const ROLES = [
  { role: "creator", label: "Celebrity", icon: Clapperboard },
  { role: "brand", label: "Brand", icon: Building2 },
  { role: "fan", label: "Fan", icon: Heart },
  { role: "admin", label: "Admin", icon: ShieldCheck },
] as const;

export function DevBar() {
  const router = useRouter();
  const [who, setWho] = useState<{ email: string | null; role: string | null }>({ email: null, role: null });
  const [busy, setBusy] = useState<string | null>(null);

  async function refreshWho() {
    const supabase = supabaseBrowser();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setWho({ email: null, role: null }); return; }
    const { data: p } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    setWho({ email: user.email ?? null, role: p?.role ?? null });
  }
  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = supabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (!alive) return;
      if (!user) { setWho({ email: null, role: null }); return; }
      const { data: p } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (alive) setWho({ email: user.email ?? null, role: p?.role ?? null });
    })();
    return () => { alive = false; };
  }, []);

  async function become(role: string) {
    setBusy(role);
    try {
      const res = await fetch("/api/dev/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const j = await res.json();
      if (!res.ok) { alert(j.hint ?? j.error ?? "dev login failed"); return; }
      await refreshWho();
      router.push(j.dest);
      router.refresh();
    } finally { setBusy(null); }
  }

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    await refreshWho();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="fixed bottom-3 left-1/2 z-[100] -translate-x-1/2">
      <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-zinc-950/90 px-2 py-1.5 text-xs text-zinc-200 shadow-lg backdrop-blur">
        <span className="flex items-center gap-1 pl-1 pr-1.5 font-medium text-amber-400">
          <FlaskConical className="size-3.5" /> DEV
        </span>
        {ROLES.map((r) => {
          const active = who.role === (r.role === "brand" ? "buyer" : r.role);
          return (
            <button key={r.role} onClick={() => become(r.role)} disabled={busy !== null}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors ${
                active ? "bg-emerald-500 text-zinc-950" : "hover:bg-zinc-800"
              }`}>
              {busy === r.role ? <Loader2 className="size-3.5 animate-spin" /> : <r.icon className="size-3.5" />}
              {r.label}
            </button>
          );
        })}
        {who.email && (
          <button onClick={signOut} aria-label="Sign out" className="ml-0.5 flex items-center gap-1 rounded-full px-2 py-1 text-zinc-400 hover:bg-zinc-800">
            <LogOut className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
