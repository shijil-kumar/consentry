// Measure a media file's real duration, server-side.
//
// WHY: the consent recorder posts `client_duration_s`, and the server used to
// take that number on trust. It is (a) client-supplied, so worthless as
// evidence, and (b) it did not even catch an honest bug — a countdown defect
// truncated the still half, and a 36-second take was accepted and stored as a
// full consent record. A consent artifact that does not contain the whole
// spoken grant is not consent, so the server has to measure for itself.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";

/**
 * Seconds of media, or null when it cannot be determined (no ffmpeg binary,
 * unreadable container). Callers must treat null as "unknown", never as zero.
 */
export async function probeDurationSeconds(media: Buffer): Promise<number | null> {
  let inPath = "";
  try {
    const ffmpegPath = (await import("ffmpeg-static")).default as unknown as string;
    if (!ffmpegPath) return null;
    inPath = join(tmpdir(), `probe-${process.pid}-${Math.random().toString(36).slice(2)}.bin`);
    await writeFile(inPath, media);
    // ffmpeg with no output writes the stream summary to stderr and exits
    // non-zero ("At least one output file must be specified") — that is the
    // documented way to probe without shipping a separate ffprobe binary, so
    // the rejection is expected and its stderr is the payload.
    let stderr = "";
    try {
      await promisify(execFile)(ffmpegPath, ["-i", inPath], { timeout: 30_000 });
    } catch (e) {
      stderr = String((e as { stderr?: string }).stderr ?? "");
    }
    const m = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(stderr);
    if (!m) return null;
    const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    return Number.isFinite(secs) ? secs : null;
  } catch {
    return null;
  } finally {
    if (inPath) await unlink(inPath).catch(() => {});
  }
}
