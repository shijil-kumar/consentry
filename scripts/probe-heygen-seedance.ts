// Empirical probe: does HeyGen's *API* expose the third-party cinematic models
// (Seedance / Veo / Kling) that their web Studio offers, and can they be driven
// with a trained photo-avatar as the character? Docs are ambiguous; the account
// is the only authority. Not shipped — .vercelignore drops scripts/probe-*.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });

const KEY = process.env.HEYGEN_API_KEY!;
const API = "https://api.heygen.com";

async function probe(label: string, url: string, init?: RequestInit) {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { "x-api-key": KEY, "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const text = await r.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep raw */ }
    console.log(`\n[${label}] ${init?.method ?? "GET"} ${url}\n  HTTP ${r.status}`);
    console.log("  " + JSON.stringify(body).slice(0, 700));
    return { status: r.status, body };
  } catch (e) {
    console.log(`\n[${label}] ERROR ${(e as Error).message}`);
    return { status: 0, body: null };
  }
}

(async () => {
  if (!KEY) { console.error("HEYGEN_API_KEY missing"); process.exit(1); }

  // 1. Which avatar groups exist (find the NEWEST trained one).
  await probe("avatar_groups", `${API}/v2/avatar_group.list`);

  // 2. Documented video-model surfaces. Any 200 here means the cinematic
  //    engines are reachable without leaving HeyGen.
  await probe("video_models", `${API}/v2/video/models`);
  await probe("templates", `${API}/v2/templates`);
  await probe("photo_avatar_look", `${API}/v2/photo_avatar/look/list`);

  // 3. The specific thing asked about: text/image -> cinematic video.
  await probe("avatar_shots", `${API}/v2/video/avatar_shots`);
  await probe("gen_video_v1", `${API}/v1/video.generate_from_text`);
})();

// second sweep — other plausible names for the cinematic surface
(async () => {
  const more = [
    ["v2 avatar_shots alt", `${API}/v2/avatar_shots`],
    ["v2 video generate opts", `${API}/v2/video/generate/options`],
    ["v1 video list", `${API}/v1/video.list`],
    ["v2 folders", `${API}/v2/folders`],
    ["v2 voices", `${API}/v2/voices`],
    ["v2 avatars", `${API}/v2/avatars`],
    ["v2 photo_avatar generate", `${API}/v2/photo_avatar/photo/generate`],
    ["v2 video_translate", `${API}/v2/video_translate/target_languages`],
  ];
  for (const [l, u] of more) await probe(l, u);
})();
