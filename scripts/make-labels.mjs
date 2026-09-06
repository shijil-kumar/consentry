// Renders the two burn-in labels to transparent PNGs: assets/label-ai.png and
// assets/label-preview.png.
//
// Why pre-render instead of drawing text at runtime? ffmpeg-static's LINUX build
// ships without libfreetype, so `drawtext` does not exist there — production
// returned "Filter not found" and every delivered video went out with no visible
// AI label while local runs (Windows ffmpeg, which has drawtext) looked perfect.
// `overlay` and `scale` are in every build, so a PNG always works.
//
// Run locally after changing the platform name or the label wording:
//   node scripts/make-labels.mjs
import { mkdirSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ff = require("ffmpeg-static");
const root = process.cwd();
const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Consentry";
const FONT = path.join(root, "assets", "fonts", "DejaVuSans.ttf");

if (!existsSync(FONT)) {
  console.error("missing assets/fonts/DejaVuSans.ttf — cannot render labels");
  process.exit(1);
}

// Rendered at ~3x the largest size we ever composite at, then scaled DOWN at
// composite time; downscaling keeps the edges clean at any video resolution.
const LABELS = [
  { file: "label-ai.png", text: `AI - ${PLATFORM}`, size: 64, pad: 26 },
  { file: "label-preview.png", text: `PREVIEW - Made with ${PLATFORM} - verified consent`, size: 52, pad: 22 },
];

mkdirSync(path.join(root, "assets"), { recursive: true });

for (const l of LABELS) {
  const dir = mkdtempSync(path.join(tmpdir(), "cf-label-"));
  copyFileSync(FONT, path.join(dir, "font.ttf"));
  // DejaVu Sans averages ~0.6em per char; the plate is the whole canvas, so the
  // canvas must fit the text plus padding. Generous width, then `crop` trims to
  // the drawn text's real box - no guessing at the final size.
  const w = Math.ceil(l.text.length * l.size * 0.62) + l.pad * 2;
  const h = l.size + l.pad * 2;
  const out = path.join(root, "assets", l.file);
  const r = spawnSync(ff, [
    "-y",
    "-f", "lavfi", "-i", `color=c=black@0.55:s=${w}x${h},format=rgba`,
    "-vf",
    `drawtext=fontfile=font.ttf:text='${l.text}':x=(w-text_w)/2:y=(h-text_h)/2:` +
    `fontsize=${l.size}:fontcolor=white@0.96`,
    "-frames:v", "1", "-update", "1", out,
  ], { cwd: dir, encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) {
    console.error(`FAILED ${l.file}:`, (r.stderr ?? "").split("\n").slice(-3).join("\n"));
    process.exit(1);
  }
  console.log(`· ${l.file}  ${w}x${h}  "${l.text}"`);
}
console.log("done — labels regenerated.");
