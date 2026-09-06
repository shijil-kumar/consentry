"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Clapperboard, Building2, Heart, Loader2 } from "lucide-react";

type Role = "creator" | "buyer" | "fan";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<Role>("creator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function landByRole() {
    const supabase = supabaseBrowser();
    const { data: userRes } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from("profiles").select("role").eq("id", userRes.user!.id).single();
    const next = params.get("next");
    const dest = next ?? (profile?.role === "creator" ? "/creator" : profile?.role === "admin" ? "/admin" : profile?.role === "fan" ? "/fan" : "/buyer");
    router.push(dest);
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      if (mode === "signup") {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email, password, role,
            display_name: displayName,
            ...(role === "creator" && handle ? { handle } : {}),
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `Signup failed (${res.status})`);
        }
      }
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) throw signInErr;
      await landByRole();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl">
          {/* An <h1> lives here because CardTitle renders a <div>: without it
              /login and /signup had no top-level heading at all. */}
          <h1 className="text-xl font-medium leading-snug">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
        </CardTitle>
        <CardDescription>
          {mode === "login"
            ? "Sign in to your dashboard."
            : "Consent-first AI endorsements — pick how you'll use the platform."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          {mode === "signup" && (
            <>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {(
                  [
                    { value: "creator", label: "Celebrity", icon: Clapperboard, blurb: "Protect & license my likeness" },
                    { value: "buyer", label: "Brand", icon: Building2, blurb: "Make official videos with stars" },
                    { value: "fan", label: "Fan", icon: Heart, blurb: "Follow stars & verify videos" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRole(opt.value)}
                    aria-pressed={role === opt.value}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      role === opt.value
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "hover:bg-muted"
                    }`}
                  >
                    <opt.icon className="mb-1.5 size-4 text-primary" />
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.blurb}</div>
                  </button>
                ))}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="name">{role === "creator" ? "Full name (as spoken on camera)" : role === "buyer" ? "Brand / company name" : "Your name"}</Label>
                <Input id="name" required minLength={2} value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={role === "creator" ? "Arjun Menon" : role === "buyer" ? "Acme Wellness" : "Your name"} />
              </div>
              {role === "creator" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="handle">Public handle (optional)</Label>
                  <Input id="handle" value={handle} pattern="[a-z0-9-]{3,30}"
                    onChange={(e) => setHandle(e.target.value.toLowerCase())}
                    placeholder="arjun" />
                </div>
              )}
            </>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required minLength={8} value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>New here? <Link className="text-primary underline-offset-4 hover:underline" href="/signup">Create an account</Link></>
            ) : (
              <>Already have an account? <Link className="text-primary underline-offset-4 hover:underline" href="/login">Sign in</Link></>
            )}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
