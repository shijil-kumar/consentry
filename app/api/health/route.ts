import { supabaseServer } from "@/lib/supabase/server";
import { probeMedia } from "@/lib/media/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Healthcheck: reports env PRESENCE (booleans only — never values) AND performs
// one trivial database read.
//
// That read is deliberate: a Supabase FREE project is paused after ~7 days with
// no database activity, and a paused database in front of investors is
// unrecoverable in the moment. Touching the DB here means ANY ping of this
// endpoint — the daily Vercel cron, an uptime monitor, or just opening the URL —
// resets that clock. Keep it cheap: a single count against a tiny public view.
export async function GET() {
  const present = (k: string) => Boolean(process.env[k] && process.env[k]!.length > 0);

  let db: "ok" | "unreachable" = "unreachable";
  try {
    const supabase = await supabaseServer();
    const { error } = await supabase
      .from("public_follow_counts")
      .select("celebrity_id", { count: "exact", head: true });
    if (!error) db = "ok";
  } catch {
    // fall through — health must never throw
  }

  return Response.json({
    ok: db === "ok",
    database: db,
    env: {
      supabase_url: present("NEXT_PUBLIC_SUPABASE_URL"),
      supabase_anon_key: present("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      supabase_service_role_key: present("SUPABASE_SERVICE_ROLE_KEY"),
      tavus_api_key: present("TAVUS_API_KEY"),
      tavus_webhook_token_secret: present("TAVUS_WEBHOOK_TOKEN_SECRET"),
      // HeyGen was missing from this list entirely, so nothing here revealed
      // whether the SECOND demo engine was configured in production. A key
      // alone is not enough either: HeyGen refuses end-user generations unless
      // the service-bureau flag is explicitly set, and without it the engine
      // silently falls back to replay.
      heygen_api_key: present("HEYGEN_API_KEY"),
      heygen_enduser_gen: process.env.HEYGEN_ALLOW_ENDUSER_GEN === "1",
      razorpay_key_id: present("RAZORPAY_KEY_ID"),
      razorpay_key_secret: present("RAZORPAY_KEY_SECRET"),
      razorpay_webhook_secret: present("RAZORPAY_WEBHOOK_SECRET"),
      anthropic_api_key: present("ANTHROPIC_API_KEY"),
      elevenlabs_api_key: present("ELEVENLABS_API_KEY"),
      // Voice-check fallback (the ElevenLabs free tier hard-fails at quota, so
      // this key is what keeps the consent flow working when that happens).
      groq_api_key: present("GROQ_API_KEY"),
      reality_defender_api_key: present("REALITY_DEFENDER_API_KEY"),
      cron_secret: present("CRON_SECRET"),
      app_base_url: present("APP_BASE_URL"),
    },
    // What each paid engine would ACTUALLY do on the next render. 'auto' means
    // live while the key works and replay once it lapses, so this is the line
    // to read before a demo.
    engines: {
      tavus: process.env.TAVUS_API_KEY ? "credentials present" : "no credentials — will replay",
      heygen: process.env.HEYGEN_API_KEY && process.env.HEYGEN_ALLOW_ENDUSER_GEN === "1"
        ? "credentials present"
        : "not usable for end-user renders — will replay",
    },
    video_provider: process.env.VIDEO_PROVIDER ?? "mock",
    // The worker resolves the engine from the AVATAR row, not from
    // VIDEO_PROVIDER, so video_provider alone can read "mock" while a paid
    // Tavus/HeyGen render actually happens. demo_safe_mode is the switch that
    // truly forces the free mock engine.
    demo_safe_mode: process.env.DEMO_SAFE_MODE === "1",
    // Whether the media toolchain can actually do what the product claims on
    // THIS host. Local success proves nothing about the serverless runtime —
    // both the visible AI label and the C2PA seal failed silently in production
    // while every local run looked perfect. Check this before demoing.
    media: await probeMedia(),
  });
}
