// Regenerates the mock provider sample that is gitignored (kept out of the repo
// to stay lean). Run after `npm install`: node scripts/fetch-binaries.mjs
//
// c2patool used to be downloaded here. Nothing calls it any more — C2PA signing
// goes through @contentauth/c2pa-node, which works on hosts the CLI cannot run
// on. Downloading 28 MB of unused binary on every build was pure cost.
//   · mock-raw.mp4 — synthesized with ffmpeg-static (the dev provider's sample)
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

function makeMockRaw() {
  const out = path.join(root, "assets", "mock-raw.mp4");
  if (existsSync(out)) { console.log("· mock-raw.mp4 present"); return; }
  mkdirSync(path.join(root, "assets"), { recursive: true });
  const ff = require("ffmpeg-static");
  spawnSync(ff, [
    "-y", "-f", "lavfi", "-i", "testsrc=duration=6:size=1280x720:rate=25",
    "-f", "lavfi", "-i", "sine=frequency=330:duration=6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
  ], { stdio: "inherit" });
  console.log("· mock-raw.mp4 generated");
}

// Resilient: a network blip or missing tool must NOT break `npm install` /
// the Vercel build. The media pipeline degrades gracefully if a binary is
// absent (watermark/sign become no-ops with a logged note).
try {
  makeMockRaw();
} catch (e) {
  console.warn("· mock-raw.mp4 gen skipped:", e?.message ?? e);
}
console.log("done.");
