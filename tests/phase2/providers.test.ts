/**
 * Phase 2 unit tests — provider adapters + callback tokens. No live API calls:
 * TavusProvider runs against stubbed fetch with response shapes recorded from
 * the real API (probe 2026-07-09) and official docs.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { MockProvider } from "@/lib/providers/mock";
import { TavusProvider } from "@/lib/providers/tavus";
import { DidProvider } from "@/lib/providers/did";
import { HeyGenProvider } from "@/lib/providers/heygen";
import { mintCallbackToken, verifyCallbackToken, callbackUrl } from "@/lib/webhooks";
import { transcriptMatchesChallenge } from "@/lib/consent";

const realFetch = globalThis.fetch;
afterEach(() => vi.stubGlobal("fetch", realFetch));

describe("MockProvider — stateless time-encoded lifecycle", () => {
  const mock = new MockProvider();

  it("fresh replica trains, old replica is ready", async () => {
    const { providerReplicaId } = await mock.createReplica({
      trainVideoUrl: "x", name: "t", callbackUrl: "x",
    });
    expect(providerReplicaId).toMatch(/^mock-r-\d+-/);
    expect((await mock.getReplica(providerReplicaId)).state).toBe("training");
    const old = `mock-r-${Date.now() - 60_000}-abc`;
    expect((await mock.getReplica(old)).state).toBe("ready");
    expect((await mock.getReplica("garbage")).state).toBe("error");
  });

  it("video walks queued → generating → ready with a download URL", async () => {
    const now = Date.now();
    expect((await mock.getVideo(`mock-v-${now}-a`)).state).toBe("queued");
    expect((await mock.getVideo(`mock-v-${now - 5000}-a`)).state).toBe("generating");
    const done = await mock.getVideo(`mock-v-${now - 60_000}-a`);
    expect(done.state).toBe("ready");
    expect(done.downloadUrl).toContain("mock://sample/");
  });
});

describe("TavusProvider — request/response mapping (fixtures from live probe)", () => {
  const tavus = new TavusProvider();

  function stub(status: number, body: unknown) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    });
    return calls;
  }

  it("createReplica posts phoenix-4 payload with x-api-key and returns replica_id", async () => {
    const calls = stub(200, { replica_id: "r-test-1", status: "started" });
    const out = await tavus.createReplica({
      trainVideoUrl: "https://signed/train.webm",
      name: "replica-abc",
      callbackUrl: "https://app/api/webhooks/tavus/tok",
    });
    expect(out.providerReplicaId).toBe("r-test-1");
    expect(calls[0].url).toBe("https://tavusapi.com/v2/replicas");
    const headers = calls[0].init!.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBeTruthy();
    const body = JSON.parse(String(calls[0].init!.body));
    expect(body).toMatchObject({
      train_video_url: "https://signed/train.webm",
      replica_name: "replica-abc",
      callback_url: "https://app/api/webhooks/tavus/tok",
      model_name: "phoenix-4",
    });
  });

  it("getReplica maps completed→ready (with thumbnail), error→error, started→training", async () => {
    stub(200, { status: "completed", thumbnail_video_url: "https://cdn/x.mp4" });
    const ready = await tavus.getReplica("r1");
    expect(ready).toMatchObject({ state: "ready", previewVideoUrl: "https://cdn/x.mp4" });

    stub(200, { status: "error", error_message: "CelebrityFoundError" });
    const failed = await tavus.getReplica("r1");
    expect(failed.state).toBe("error");
    expect(failed.error).toContain("Celebrity");

    stub(200, { status: "started", training_progress: "40/100" });
    expect((await tavus.getReplica("r1")).state).toBe("training");
  });

  it("getVideo maps ready/deleted/queued and generateVideo passes fast flag", async () => {
    stub(200, { status: "ready", download_url: "https://dl/x.mp4", hosted_url: "https://h/x" });
    const done = await tavus.getVideo("v1");
    expect(done).toMatchObject({ state: "ready", downloadUrl: "https://dl/x.mp4" });

    stub(200, { status: "deleted" });
    expect((await tavus.getVideo("v1")).state).toBe("error");

    stub(200, { status: "queued" });
    expect((await tavus.getVideo("v1")).state).toBe("queued");

    const calls = stub(200, { video_id: "v-9" });
    await tavus.generateVideo({
      providerReplicaId: "r1", script: "hello world script",
      videoName: "gen-1", callbackUrl: "https://cb", fast: true,
    });
    const body = JSON.parse(String(calls[0].init!.body));
    expect(body).toMatchObject({ replica_id: "r1", fast: true });
  });

  it("non-2xx surfaces a tavus:op error", async () => {
    stub(402, { message: "payment required" });
    await expect(tavus.createReplica({ trainVideoUrl: "x", name: "n", callbackUrl: "c" }))
      .rejects.toThrow(/tavus:createReplica 402/);
  });
});

describe("DidProvider — real shapes (Talks), no training step", () => {
  const did = new DidProvider();
  function stub(status: number, body: unknown) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init }); return new Response(JSON.stringify(body), { status });
    });
    return calls;
  }
  it("createReplica returns the source url (no training); getReplica is ready", async () => {
    const r = await did.createReplica({ trainVideoUrl: "https://host/face.jpg", name: "x", callbackUrl: "c" });
    expect(r.providerReplicaId).toBe("https://host/face.jpg");
    expect((await did.getReplica("https://host/face.jpg")).state).toBe("ready");
  });
  it("generateVideo POSTs /talks with Basic auth and returns id", async () => {
    process.env.DID_API_KEY = "me@x.com:secret";
    const calls = stub(201, { id: "tlk_1", status: "created" });
    const out = await did.generateVideo({ providerReplicaId: "https://host/face.jpg", script: "hi", videoName: "v", callbackUrl: "cb" });
    expect(out.providerVideoId).toBe("tlk_1");
    expect(calls[0].url).toBe("https://api.d-id.com/talks");
    expect((calls[0].init!.headers as Record<string, string>).authorization).toMatch(/^Basic /);
  });
  it("getVideo maps done→ready(result_url), error→error", async () => {
    process.env.DID_API_KEY = "me@x.com:secret";
    stub(200, { status: "done", result_url: "https://r/x.mp4" });
    expect((await did.getVideo("tlk_1"))).toMatchObject({ state: "ready", downloadUrl: "https://r/x.mp4" });
    stub(200, { status: "error", error: "bad" });
    expect((await did.getVideo("tlk_1")).state).toBe("error");
  });
});

describe("HeyGenProvider — built but ToS-gated", () => {
  it("refuses to generate without the explicit ToS opt-in flag", async () => {
    delete process.env.HEYGEN_ALLOW_ENDUSER_GEN;
    process.env.HEYGEN_API_KEY = "k";
    await expect(new HeyGenProvider().generateVideo({
      providerReplicaId: "a", script: "s", videoName: "v", callbackUrl: "c",
    })).rejects.toThrow(/service-bureau|ToS-restricted|restricted/i);
  });
  it("getVideo maps completed→ready without needing the flag (read-only)", async () => {
    process.env.HEYGEN_API_KEY = "k";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: { status: "completed", video_url: "https://h/v.mp4" } }), { status: 200 }));
    expect((await new HeyGenProvider().getVideo("v1"))).toMatchObject({ state: "ready", downloadUrl: "https://h/v.mp4" });
  });
});

describe("callback tokens", () => {
  it("mint → verify round-trip; tampering fails", () => {
    const token = mintCallbackToken("replica", "abc-123");
    expect(verifyCallbackToken(token)).toEqual({ jobType: "replica", entityId: "abc-123" });
    expect(verifyCallbackToken(token.slice(0, -2) + "ff")).toBeNull();
    expect(verifyCallbackToken("garbage")).toBeNull();
    expect(callbackUrl("video", "v-1")).toContain("/api/webhooks/tavus/");
  });
});

describe("voice-captcha matcher regression", () => {
  it("matches when STT joins spoken digits", () => {
    const r = transcriptMatchesChallenge(
      "My verification phrase is Amber Falcon 472. I repeat, Amber Falcon 472.",
      "amber falcon 4 7 2",
    );
    expect(r.matched).toBe(true);
  });
});
