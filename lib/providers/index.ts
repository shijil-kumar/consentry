import { MockProvider } from "./mock";
import { TavusProvider } from "./tavus";
import { DidProvider } from "./did";
import { HeyGenProvider } from "./heygen";
import { ReplayProvider } from "./replay";
import type { VideoGenProvider } from "./types";

// All engines live behind one interface so VIDEO_PROVIDER selects at go-live,
// one at a time. mock is the dev/test default (COST CONTROL). tavus is primary.
// did is the fallback. heygen is BUILT but ToS-gated (service-bureau ban) — it
// refuses to run without HEYGEN_ALLOW_ENDUSER_GEN=1.
const providers: Record<string, VideoGenProvider> = {
  mock: new MockProvider(),
  tavus: new TavusProvider(),
  did: new DidProvider(),
  heygen: new HeyGenProvider(),
};

// Env-selected provider for NEW work (dev/tests default to mock — COST CONTROL).
export function activeProvider(): VideoGenProvider {
  return providers[process.env.VIDEO_PROVIDER ?? "mock"] ?? providers.mock;
}

// Provider for an EXISTING row (avatars.provider / generations.provider) —
// in-flight work keeps its original engine even if the env switches.
export function providerFor(name: string): VideoGenProvider {
  const p = providers[name];
  if (!p) throw new Error(`unknown provider: ${name}`);
  return p;
}

export type { VideoGenProvider } from "./types";

// ── Replay resolution ──────────────────────────────────────────────────────
// Tavus and HeyGen are paid subscriptions. When one lapses, the demo must not
// die at the render step — the rest of the pipeline (gate, licence, approval,
// watermark, C2PA seal, delivery, verification) is the actual product and is
// entirely unaffected by whose GPU drew the pixels. `replay` swaps ONLY the
// provider call for that engine's own earlier output.
export type EngineMode = "auto" | "live" | "replay";
export type ReplayableEngine = "tavus" | "heygen";

/** Does this engine have what it needs to render for real right now? */
export function engineHasCredentials(engine: string): boolean {
  if (engine === "tavus") return Boolean(process.env.TAVUS_API_KEY);
  if (engine === "heygen") {
    // HeyGen additionally refuses to run end-user generations unless the
    // service-bureau flag is explicitly set, so a key alone is not enough.
    return Boolean(process.env.HEYGEN_API_KEY) && process.env.HEYGEN_ALLOW_ENDUSER_GEN === "1";
  }
  return true; // mock/did need nothing from us here
}

/**
 * Pick the provider for an engine, honouring the platform switch.
 *
 * 'auto' (the default) is the one that matters operationally: it renders live
 * while a key is configured and falls back to replay when it is not — so
 * cancelling a subscription degrades to a working demo instead of an error.
 */
export function resolveEngine(engine: string, mode: EngineMode = "auto", opts?: {
  /** The brand explicitly asked for an instant preview of THIS engine. */
  instant?: boolean;
}): {
  provider: VideoGenProvider;
  renderMode: "live" | "replay";
  reason: string;
} {
  const replayable = engine === "tavus" || engine === "heygen";
  if (!replayable) {
    return { provider: providerFor(engine), renderMode: "live", reason: `${engine} is not a paid engine` };
  }
  // An explicit instant request outranks the platform setting: the brand asked
  // to SEE this engine, not to spend on it. It cannot outrank the consent and
  // avatar gates, which ran before this is ever consulted.
  if (opts?.instant) {
    return {
      provider: new ReplayProvider(engine, { instant: true }),
      renderMode: "replay",
      reason: "brand asked for an instant preview of this engine",
    };
  }
  if (mode === "live") {
    return { provider: providerFor(engine), renderMode: "live", reason: "forced live by platform setting" };
  }
  if (mode === "replay") {
    return { provider: new ReplayProvider(engine), renderMode: "replay", reason: "forced replay by platform setting" };
  }
  return engineHasCredentials(engine)
    ? { provider: providerFor(engine), renderMode: "live", reason: "auto: credentials present" }
    : { provider: new ReplayProvider(engine), renderMode: "replay", reason: "auto: no usable credentials for this engine" };
}
