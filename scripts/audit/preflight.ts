/* eslint-disable @typescript-eslint/no-explicit-any */
// Preflight guard, run before anything that touches .next/
//
// WHY THIS EXISTS: `next dev` and `next build` share the .next/ directory. If a
// build runs while the dev server is live, the dev server rewrites manifests
// mid-build and the output is silently corrupted — pages 200 but every JS/CSS
// asset 404s. It does not fail loudly; it fails *plausibly*, which is worse.
// This turns that into a hard stop.
import { config } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Without this the env checks below report every variable as missing — the
// script would "fail" for reasons that have nothing to do with the codebase.
config({ path: path.resolve(process.cwd(), ".env.local") });

const DEV_PORTS = [3000, 3001, 3100, 3101, 3102];

function listeningPorts(): number[] {
  try {
    // Windows: netstat is the portable option here (lsof is not present).
    // execFileSync with an argument array — no shell, so nothing here can be
    // turned into a command-injection vector even if the inputs ever change.
    const out = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const found = new Set<number>();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/LISTENING/i) && line.match(/:(\d+)\s/);
      if (m) {
        const port = Number(m[1]);
        if (DEV_PORTS.includes(port)) found.add(port);
      }
    }
    return [...found];
  } catch {
    return [];
  }
}

/** Is a Next DEV server for THIS project serving on this port?
 *
 *  Two independent signals, both required:
 *    1. DEV: /_next/static/development/* only exists under `next dev`. An
 *       earlier version sniffed the HTML for webpack chunk names, which silently
 *       stopped matching under Turbopack — the guard reported "safe to build"
 *       while our own dev server was live, i.e. it failed exactly when needed.
 *    2. OURS: /api/health returns this app's distinctive shape. A dev server for
 *       a different project uses its own .next and cannot corrupt our build,
 *       and this machine routinely runs more than one Next app.
 */
async function isOurDevServer(port: number): Promise<boolean> {
  const base = `http://127.0.0.1:${port}`;
  try {
    const dev = await fetch(`${base}/_next/static/development/_devMiddlewareManifest.json`,
      { signal: AbortSignal.timeout(2500) }).then((r) => r.ok).catch(() => false);
    if (!dev) return false;
    const h: any = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2500) })
      .then((x) => x.json()).catch(() => null);
    return Boolean(h && typeof h === "object" && "media" in h && "video_provider" in h);
  } catch {
    return false;
  }
}

export async function preflight(opts: { forBuild: boolean }): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  let ok = true;

  if (opts.forBuild) {
    const ports = listeningPorts();
    const live: number[] = [];
    for (const p of ports) if (await isOurDevServer(p)) live.push(p);
    if (live.length) {
      ok = false;
      notes.push(
        `A dev server for THIS project is live on port ${live.join(", ")}. Building now would corrupt ` +
        `.next/ (shared directory) and silently 404 every asset. Stop it, then re-run.`,
      );
    } else {
      notes.push(`No dev server for this project on ${DEV_PORTS.join("/")} — safe to build.` +
        (ports.length ? ` (Ports busy with other apps: ${ports.join(", ")} — harmless, separate .next.)` : ""));
    }
  }

  // .env must never be committed.
  try {
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/).filter((f) => /^\.env/.test(f) && f !== ".env.example");
    if (tracked.length) { ok = false; notes.push(`SECRET LEAK: these env files are committed: ${tracked.join(", ")}`); }
    else notes.push("No .env files tracked by git (only .env.example).");
  } catch {
    notes.push("git not available — skipped the tracked-env-file check.");
  }

  // Required config for the suite to mean anything.
  for (const v of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[v]) { ok = false; notes.push(`Missing ${v} — the audit cannot verify anything without it.`); }
  }

  // A stale .next from an interrupted build is its own failure mode.
  const bid = path.join(process.cwd(), ".next", "BUILD_ID");
  if (opts.forBuild && existsSync(bid)) {
    notes.push(`Existing build present (BUILD_ID=${readFileSync(bid, "utf8").trim().slice(0, 12)}…).`);
  }
  return { ok, notes };
}

if (process.argv[1] && process.argv[1].includes("preflight")) {
  const forBuild = process.argv.includes("--build");
  preflight({ forBuild }).then(({ ok, notes }) => {
    console.log("PREFLIGHT");
    notes.forEach((n) => console.log(`  ${ok ? "•" : "!"} ${n}`));
    process.exit(ok ? 0 : 1);
  });
}
