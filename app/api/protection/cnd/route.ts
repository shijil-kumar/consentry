import { z } from "zod";
import { supabaseForRequest } from "@/lib/supabase/server";

export const maxDuration = 30;

// Cease-and-desist DRAFT generator. Drafts only — nothing is ever sent from
// here (sending is a disclosed Phase-2 service). The letter is grounded in the
// caller's own ledger facts, fetched under their JWT (RLS).
const Body = z.object({
  target: z.string().trim().min(3).max(200),          // where the misuse was seen
  description: z.string().trim().min(10).max(1000),   // what the content shows
});

export async function POST(req: Request) {
  const supabase = await supabaseForRequest(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { data: profile } = await supabase
    .from("profiles").select("display_name, role, handle").eq("id", user.id).single();
  if (!profile || profile.role !== "creator") {
    return Response.json({ error: "celebrities_only" }, { status: 403 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "drafter_unavailable" }, { status: 503 });
  }

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch { return Response.json({ error: "invalid_body" }, { status: 400 }); }

  // Ledger facts under the caller's own JWT
  const { data: consent } = await supabase
    .from("consent_records").select("status, verified_at, content_hash")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01", "content-type": "application/json",
      },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model: process.env.POLICY_MODEL ?? "claude-haiku-4-5",
        max_tokens: 900, temperature: 0.2,
        system:
          "You draft a firm, professional cease-and-desist letter for unauthorized use of a person's AI likeness in India. Ground it in: the Information Technology Rules 2026 (synthetic media labeling + takedown duties), Indian personality-rights jurisprudence (e.g. Delhi High Court injunctions in Anil Kapoor 2023, Aishwarya Rai 2025), and the person's verifiable consent registry. Include placeholders like [PLATFORM/HOST NAME] where facts are unknown. End with a 48-hour compliance demand. Plain text only, no markdown. This is a DRAFT for review by the rights-holder's lawyer, and must say so at the top.",
        messages: [{
          role: "user",
          content: `Rights holder: ${profile.display_name} (registry: /c/${profile.handle ?? ""})\nConsent registry status: ${consent?.status ?? "on record"}, verified ${consent?.verified_at ?? "-"}, record fingerprint sha256:${(consent?.content_hash ?? "").slice(0, 16)}…\nWhere the unauthorized content appears: ${body.target}\nWhat it shows: ${body.description}\n\nDraft the letter.`,
        }],
      }),
    });
    if (!res.ok) return Response.json({ error: `llm_${res.status}` }, { status: 502 });
    const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    const letter = data.content.find((c) => c.type === "text")?.text?.trim();
    if (!letter) return Response.json({ error: "no_output" }, { status: 502 });
    return Response.json({ ok: true, letter });
  } catch (e) {
    return Response.json({ error: (e as Error).message.slice(0, 120) }, { status: 502 });
  }
}
