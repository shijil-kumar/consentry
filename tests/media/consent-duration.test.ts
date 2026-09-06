/**
 * The consent recorder once shipped a countdown bug that cut the "sit still"
 * half to about one second, so takes came out 36s instead of 65s — and the
 * server stored them as valid consent because it trusted a client-supplied
 * duration field. These tests cover the server-side measurement that now
 * backstops that: real media in, real seconds out.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { probeDurationSeconds } from "../../lib/media/duration";

const run = promisify(execFile);
let ffmpegPath = "";

/** Synthesize a silent test clip of an exact length. */
async function makeClip(seconds: number): Promise<Buffer> {
  const out = join(tmpdir(), `dur-test-${seconds}-${Math.random().toString(36).slice(2)}.mp4`);
  await run(ffmpegPath, [
    "-f", "lavfi", "-i", `color=c=black:s=320x240:d=${seconds}`,
    "-f", "lavfi", "-i", `anullsrc=r=16000:cl=mono`,
    "-t", String(seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", out,
  ], { timeout: 120_000 });
  const buf = await readFile(out);
  await unlink(out).catch(() => {});
  return buf;
}

describe("consent recording duration is measured, not trusted", () => {
  beforeAll(async () => {
    ffmpegPath = (await import("ffmpeg-static")).default as unknown as string;
    expect(ffmpegPath, "ffmpeg-static must resolve").toBeTruthy();
  });

  it("measures a full-length take within a second of the truth", async () => {
    const clip = await makeClip(65);
    const d = await probeDurationSeconds(clip);
    expect(d).not.toBeNull();
    expect(Math.abs(d! - 65)).toBeLessThan(1);
  }, 180_000);

  it("measures a truncated take as truncated — the exact bug that shipped", async () => {
    const clip = await makeClip(36);
    const d = await probeDurationSeconds(clip);
    expect(d).not.toBeNull();
    expect(Math.abs(d! - 36)).toBeLessThan(1);
    // 52s is the server's floor; a 36s take must fall below it.
    expect(d!).toBeLessThan(52);
  }, 180_000);

  it("returns null rather than 0 for input it cannot read", async () => {
    // null means "unknown" and must never be mistaken for a zero-length take,
    // which would reject every submission if ffmpeg were missing in production.
    const d = await probeDurationSeconds(Buffer.from("this is not a video"));
    expect(d).toBeNull();
  }, 60_000);
});
