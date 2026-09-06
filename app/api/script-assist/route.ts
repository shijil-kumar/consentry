import { z } from "zod";
import { supabaseForRequest } from "@/lib/supabase/server";

export const maxDuration = 30;

// AI script assistant — drafts a compliant endorsement script for the brand,
// pre-shaped by the creator's allowed categories + prohibited-use rules so the
// draft is far more likely to pass the gate. Uses the same Claude the gate uses.
const Body = z.object({
  listing_id: z.string().uuid(),
  brief: z.string().trim().min(5).max(600),
  variants: z.boolean().optional(), // true → 3 A/B hook variants instead of one script
});

export async function POST(req: Request) {
  const supabase = await supabaseForRequest(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch { return Response.json({ error: "invalid_body" }, { status: 400 }); }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "assistant_unavailable" }, { status: 503 });
  }

  // Public data only (anon-readable views) — no privileged read needed.
  const [{ data: listing }, { data: rules }] = await Promise.all([
    supabase.from("public_listings").select("display_name, allowed_categories").eq("id", body.listing_id).maybeSingle(),
    supabase.from("public_listing_rules").select("title, description").eq("listing_id", body.listing_id),
  ]);
  if (!listing) return Response.json({ error: "listing_not_found" }, { status: 404 });

  const wantVariants = body.variants === true;
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
        max_tokens: wantVariants ? 900 : 500, temperature: 0.7,
        system:
          "You write short, natural endorsement scripts for AI-avatar videos. The script will be SPOKEN on camera by a creator's licensed AI replica. Keep each script 2-4 sentences, ~40-70 words, warm and specific. You MUST respect the creator's prohibited-use rules absolutely — never write anything that could violate them (no medical/health claims, no financial advice, no false personal-use claims unless the brief states it's true, etc.)." +
          (wantVariants
            ? " Write EXACTLY 3 variants with DIFFERENT opening hooks (e.g. question hook, story hook, bold-statement hook). Separate them with a line containing only '---'. No numbering, no labels, no preamble."
            : " Return ONLY the script text, no preamble."),
        messages: [{
          role: "user",
          content: `Creator: ${listing.display_name}\nAllowed categories: ${listing.allowed_categories.join(", ")}\nProhibited rules (never violate): ${(rules ?? []).map((r) => `${r.title} — ${r.description}`).join(" | ") || "platform defaults only"}\n\nBrand brief: ${body.brief}\n\n${wantVariants ? "Write 3 endorsement script variants." : "Write the endorsement script."}`,
        }],
      }),
    });
    if (!res.ok) return Response.json({ error: `llm_${res.status}` }, { status: 502 });
    const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    const text = data.content.find((c) => c.type === "text")?.text?.trim();
    if (!text) return Response.json({ error: "no_output" }, { status: 502 });
    if (wantVariants) {
      const variants = text.split(/\n-{3,}\n/).map((v) => v.trim()).filter((v) => v.length > 20).slice(0, 3);
      if (variants.length === 0) return Response.json({ error: "no_output" }, { status: 502 });
      return Response.json({ ok: true, script: variants[0], variants });
    }
    return Response.json({ ok: true, script: text });
  } catch (e) {
    return Response.json({ error: (e as Error).message.slice(0, 120) }, { status: 502 });
  }
}
