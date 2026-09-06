import type { NextConfig } from "next";

// The media pipeline spawns ffmpeg and loads the C2PA native module, and reads
// assets/ (mock master, burn-in label PNGs, signing certificate). Next's file
// tracing drops all of that from the serverless bundle unless it is named
// explicitly — the \ROOT\ turbopack rewrite is why they are resolved from
// process.cwd() at runtime rather than by import path.
//
// bin/c2patool is deliberately NOT bundled any more: the CLI cannot run on a
// serverless host (its Linux builds link GLIBC_2.39; the runtime provides 2.34),
// so it was 28 MB of dead weight that silently failed on every delivery. Signing
// now goes through @contentauth/c2pa-node, whose native binding is built against
// GLIBC_2.34 exactly. The CLI stays in the repo for local scripting only.
const MEDIA = [
  "./assets/**",
  "./node_modules/ffmpeg-static/**",
  "./node_modules/@contentauth/**",
];

const nextConfig: NextConfig = {
  // Next sets `x-powered-by: Next.js` by default. Vercel happens to strip it,
  // so production was clean by luck rather than by configuration — anywhere
  // else this app runs, it would hand attackers the framework for free.
  poweredByHeader: false,
  // Pin the workspace root. There is a stray package-lock.json in the user's
  // HOME directory, so Turbopack inferred the root as C:\Users\<name> and warned
  // on every build. That matters more than a warning here: the root is what
  // outputFileTracingIncludes globs are resolved against, and this app's whole
  // media pipeline depends on those globs shipping assets/ and the native C2PA
  // module into the serverless function.
  turbopack: { root: __dirname },

  // The C2PA binding ships a native .node addon. Turbopack cannot place a
  // non-ECMAScript asset in an ESM chunk ("asset is not placeable in ESM
  // chunks") and the build fails outright — so require it at runtime instead
  // of bundling it. outputFileTracingIncludes below is what actually ships the
  // module to the function.
  serverExternalPackages: ["@contentauth/c2pa-node"],
  outputFileTracingIncludes: {
    "/api/jobs/generation-worker": MEDIA,
    "/api/jobs/replica-worker": ["./assets/**"],
    "/api/inspect": ["./node_modules/@contentauth/**"],
    "/api/health": MEDIA,
    "/api/consent/authenticity": ["./node_modules/ffmpeg-static/**"],
    // The voice check strips the video track before transcribing (a 26.8 MB
    // clip becomes 141 KB of audio), so this route needs ffmpeg too. Without
    // this glob the binary is absent in production and extraction silently
    // falls back to posting the whole video.
    "/api/consent/submit": ["./node_modules/ffmpeg-static/**"],
  },

  // Baseline security headers on every response. A pentest on 2026-08-05 found
  // these missing. The most important is frame protection: without it, an
  // attacker could iframe /approve/<token> and clickjack a celebrity into
  // approving a video. HSTS is already added by the host; the rest are
  // defence-in-depth against MIME-sniffing and referrer leakage.
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
