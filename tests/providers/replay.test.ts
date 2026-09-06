/**
 * Engine replay: the demo must survive a cancelled Tavus or HeyGen plan.
 *
 * The rule these tests defend is narrow and important: replay substitutes the
 * PROVIDER CALL and nothing else. It must never invent consent, never claim to
 * be a live render, and never quietly apply to an engine the operator has
 * explicitly forced live.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveEngine, engineHasCredentials } from "../../lib/providers";
import { ReplayProvider, readReplayMaster } from "../../lib/providers/replay";
import { buildManifest } from "../../lib/media/pipeline";

const KEYS = ["TAVUS_API_KEY", "HEYGEN_API_KEY", "HEYGEN_ALLOW_ENDUSER_GEN"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("engine resolution", () => {
  it("renders live when the subscription is present", () => {
    process.env.TAVUS_API_KEY = "tk_live_example";
    const r = resolveEngine("tavus", "auto");
    expect(r.renderMode).toBe("live");
    expect(r.provider.name).toBe("tavus");
  });

  it("falls back to replay when the key is gone - the whole point", () => {
    delete process.env.TAVUS_API_KEY;
    const r = resolveEngine("tavus", "auto");
    expect(r.renderMode).toBe("replay");
    // Still attributed to the engine it stands in for, so records stay truthful.
    expect(r.provider.name).toBe("tavus");
  });

  it("HeyGen needs the service-bureau flag, not just a key", () => {
    process.env.HEYGEN_API_KEY = "hg_example";
    delete process.env.HEYGEN_ALLOW_ENDUSER_GEN;
    expect(engineHasCredentials("heygen")).toBe(false);
    expect(resolveEngine("heygen", "auto").renderMode).toBe("replay");
    process.env.HEYGEN_ALLOW_ENDUSER_GEN = "1";
    expect(engineHasCredentials("heygen")).toBe(true);
  });

  it("'live' is an override: it never silently downgrades to replay", () => {
    delete process.env.TAVUS_API_KEY;
    const r = resolveEngine("tavus", "live");
    expect(r.renderMode).toBe("live"); // will fail loudly at the API, by design
  });

  it("'replay' is an override: it never spends even with a valid key", () => {
    process.env.TAVUS_API_KEY = "tk_live_example";
    expect(resolveEngine("tavus", "replay").renderMode).toBe("replay");
  });

  it("leaves non-paid engines alone", () => {
    expect(resolveEngine("mock", "auto").renderMode).toBe("live");
  });

  // An instant preview is the brand asking to SEE an engine, not to buy from
  // it, so it outranks whatever the platform is set to — in both directions.
  it("an instant request replays even when the engine is set to live", () => {
    process.env.TAVUS_API_KEY = "tk_live_example";
    const r = resolveEngine("tavus", "live", { instant: true });
    expect(r.renderMode).toBe("replay");
    expect(r.provider.name).toBe("tavus");
  });

  it("an instant request of HeyGen replays HeyGen, not some generic sample", () => {
    const r = resolveEngine("heygen", "auto", { instant: true });
    expect(r.renderMode).toBe("replay");
    expect(r.provider.name).toBe("heygen");
  });

  it("without the instant flag, a live-set engine still renders live", () => {
    process.env.TAVUS_API_KEY = "tk_live_example";
    expect(resolveEngine("tavus", "live").renderMode).toBe("live");
  });
});

describe("the replay provider", () => {
  it("reports generating before ready - a demo needs the rendering state", async () => {
    const p = new ReplayProvider("tavus");
    const { providerVideoId } = await p.generateVideo();
    expect((await p.getVideo(providerVideoId)).state).toBe("generating");
  });

  it("instant mode is ready immediately - that is what makes it instant", async () => {
    const p = new ReplayProvider("tavus", { instant: true });
    const { providerVideoId } = await p.generateVideo();
    const st = await p.getVideo(providerVideoId);
    expect(st.state).toBe("ready");
    expect(st.downloadUrl).toMatch(/^replay:\/\/tavus\//);
  });

  it("each engine's instant preview points at ITS OWN master", async () => {
    const t = new ReplayProvider("tavus", { instant: true });
    const h = new ReplayProvider("heygen", { instant: true });
    const tv = await t.getVideo((await t.generateVideo()).providerVideoId);
    const hv = await h.getVideo((await h.generateVideo()).providerVideoId);
    expect(tv.downloadUrl).toMatch(/tavus/);
    expect(hv.downloadUrl).toMatch(/heygen/);
    expect(tv.downloadUrl).not.toBe(hv.downloadUrl);
  });

  it("hands back a URL the worker resolves to that engine's own master", async () => {
    const p = new ReplayProvider("heygen");
    // Backdate the id past the simulated render window.
    const id = `replay-v-${Date.now() - 60_000}-abc123`;
    const st = await p.getVideo(id);
    expect(st.state).toBe("ready");
    expect(st.downloadUrl).toMatch(/^replay:\/\/heygen\//);
    const bytes = await readReplayMaster(new URL(st.downloadUrl!).hostname);
    expect(bytes.byteLength).toBeGreaterThan(100_000);
  });

  it("refuses an engine it has no master for, rather than guessing", async () => {
    await expect(readReplayMaster("someone-elses-engine")).rejects.toThrow(/no master/);
  });

  it("rejects a path-traversal engine name", async () => {
    await expect(readReplayMaster("../../etc/passwd")).rejects.toThrow(/no master/);
  });
});

describe("honesty", () => {
  const base = {
    generationId: "g",
    licenseId: "l",
    requestId: "r",
    creatorHandle: "arjun",
    buyerOrgName: "Acme",
    consentRecordHash: "h",
    consentVerifiedAt: null,
    scriptSha256: "s",
    licenseExpiresAt: null,
    verifyUrl: "https://x/y",
    provider: "tavus",
  };

  it("a replayed render says so INSIDE its Content Credentials", () => {
    const m = buildManifest({ ...base, renderMode: "replay" });
    const lic = m.assertions.find((a) => a.label === "com.consentfirst.license")!;
    expect((lic.data as Record<string, unknown>).render_mode).toBe("replay");
    expect(String((lic.data as Record<string, unknown>).render_note)).toMatch(/stood in/i);
    const act = m.assertions.find((a) => a.label === "c2pa.actions.v2")!;
    expect(JSON.stringify(act.data)).toMatch(/replayed sample/i);
  });

  it("a live render is not labelled as a replay", () => {
    const m = buildManifest({ ...base, renderMode: "live" });
    const lic = m.assertions.find((a) => a.label === "com.consentfirst.license")!;
    expect((lic.data as Record<string, unknown>).render_mode).toBe("live");
    expect((lic.data as Record<string, unknown>).render_note).toBeUndefined();
    expect(JSON.stringify(m)).not.toMatch(/replayed sample/i);
  });

  it("defaults to live when nothing is stated, so replay is never assumed", () => {
    const m = buildManifest(base);
    const lic = m.assertions.find((a) => a.label === "com.consentfirst.license")!;
    expect((lic.data as Record<string, unknown>).render_mode).toBe("live");
  });
});
