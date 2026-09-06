"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Clapperboard, Loader2 } from "lucide-react";

type Mode = "auto" | "live" | "replay";

const MODES: Array<{ key: Mode; label: string; hint: string }> = [
  { key: "auto", label: "Auto", hint: "Render live while the subscription works; replay if it lapses." },
  { key: "live", label: "Live only", hint: "Always call the paid API. Fails loudly if the key is gone." },
  { key: "replay", label: "Replay", hint: "Never call the API. Rehearse without spending." },
];

const ENGINES: Array<{ key: "tavus" | "heygen"; label: string; note: string }> = [
  { key: "tavus", label: "Tavus", note: "Widescreen 16:9 studio replica" },
  { key: "heygen", label: "HeyGen", note: "Vertical 9:16 social avatar" },
];

// Lets a demo survive a cancelled subscription. Replay keeps the whole pipeline
// real — rules gate, licence, wallet debit, approval link, visible AI label,
// Content Credentials, delivery, verification — and swaps only the provider
// call for that engine's own earlier render.
export function EngineModePanel({ initial }: { initial: Record<string, Mode> }) {
  const router = useRouter();
  const [modes, setModes] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function set(engine: string, mode: Mode) {
    setBusy(engine); setError(null);
    const { error } = await supabaseBrowser().rpc("update_platform_setting", {
      p_key: `engine_mode_${engine}`, p_value: mode,
    });
    setBusy(null);
    if (error) { setError(error.message); return; }
    setModes((m) => ({ ...m, [engine]: mode }));
    router.refresh();
  }

  return (
    <Card id="engines" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clapperboard className="size-4 text-primary" /> Video engines
        </CardTitle>
        <CardDescription>
          If you stop paying for an engine, switch it to <b>Replay</b> (or leave it on Auto) and the
          demo still runs end to end. Only the render step is substituted — and every video says so,
          on the page and inside its Content Credentials.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {ENGINES.map((e) => (
          <div key={e.key} className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">
                {e.label} <span className="text-xs font-normal text-muted-foreground">· {e.note}</span>
              </p>
              {busy === e.key && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {MODES.map((m) => {
                const active = (modes[e.key] ?? "auto") === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => set(e.key, m.key)}
                    disabled={busy !== null}
                    aria-pressed={active}
                    className={`rounded-lg border p-2.5 text-left transition-colors disabled:opacity-60 ${
                      active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-muted-foreground/40"
                    }`}
                  >
                    <span className="block text-sm font-medium">{m.label}</span>
                    <span className="block text-xs text-muted-foreground">{m.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
