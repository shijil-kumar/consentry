"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  Camera, Circle, Loader2, Mic, RefreshCcw, ShieldCheck, UploadCloud, AlertTriangle,
} from "lucide-react";

const SPEAK_SECONDS = 35; // read the consent script + challenge phrase
const STILL_SECONDS = 30; // Tavus phoenix-4 wants ~30s of still footage

type Phase =
  | "loading" | "intro" | "preview" | "speak" | "still"
  | "review" | "uploading" | "done" | "error";

interface Challenge { phrase: string; issuedAt: number; sig: string }
interface SubmitResult {
  consent_id: string;
  content_hash: string;
  voice_captcha: { verified: boolean; error: string | null };
}

function pickMimeType(): { mime: string; ext: string } {
  const candidates: Array<[string, string]> = [
    ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', "mp4"],
    ["video/mp4", "mp4"],
    ['video/webm;codecs="vp9,opus"', "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mime, ext] of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return { mime, ext };
    }
  }
  return { mime: "video/webm", ext: "webm" };
}

export function ConsentRecorder({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [script, setScript] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  // mirrors blobRef for RENDER decisions (reading a ref during render is
  // disallowed) — lets the error state offer 'Retry upload' when the take survived
  const [hasFootage, setHasFootage] = useState(false);
  // null = not counting in; 3..1 = the lead-in shown over the frame.
  const [leadIn, setLeadIn] = useState<number | null>(null);
  // Setup choices, modelled on HeyGen's pre-record row. Orientation matters most:
  // it fixes the aspect ratio of every video this likeness will ever produce —
  // landscape footage gives 16:9 output, portrait gives Reels/Shorts.
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>("");
  const [micId, setMicId] = useState<string>("");
  const durationRef = useRef(0);
  const mimeRef = useRef(pickMimeType());
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const prompterRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keeps the screen awake for the take. THE failure mode for this flow: the
  // second half is 30 seconds of sitting still and silent, so a phone set to a
  // 30s auto-lock locks itself mid-consent — and iOS suspends the capture
  // stream the instant the screen locks or Safari backgrounds, truncating the
  // recording with no error. https://webkit.org/blog/11353/mediarecorder-api/
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const stopWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const levelRafRef = useRef(0);
  /** 0..1 live mic level, sampled during preview. */
  const [micLevel, setMicLevel] = useState(0);
  /** True once we have actually heard something above the noise floor. */
  const [micHeard, setMicHeard] = useState(false);
  /** True when the primary control must be pinned to stay reachable. */
  const [compact, setCompact] = useState(false);
  const interruptedRef = useRef(false);
  // The visibility handler must see the live phase without re-subscribing on
  // every state change (which would drop events between renders).
  const phaseRef = useRef<Phase>("loading");

  const releaseWake = useCallback(() => {
    wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
  }, []);

  const acquireWake = useCallback(async () => {
    // Feature-detected and best-effort: the browser may refuse at runtime (low
    // battery, hidden page) even when the API exists, so this must never be
    // allowed to block or fail a recording.
    try {
      if ("wakeLock" in navigator) {
        wakeRef.current = await navigator.wakeLock.request("screen");
      }
    } catch { /* recording proceeds without it */ }
  }, []);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    if (phase !== "preview") return;
    // Two frames: one for the phase render, one for the aspect-ratio box to be
    // measured. Then bring the whole frame — and the mic meter pinned to it —
    // into view.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        frameRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })));
    return () => cancelAnimationFrame(raf);
  }, [phase, orientation]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px), (max-height: 719px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const fail = useCallback((msg: string) => {
    // Whatever went wrong, the camera light must go out and the screen must be
    // allowed to sleep again — leaving either on after an error is its own bug.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    releaseWake();
    setError(msg);
    setPhase("error");
  }, [releaseWake]);

  // 1) fetch the signed challenge + personalized script
  useEffect(() => {
    fetch("/api/consent/challenge")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? `challenge ${r.status}`);
        return r.json();
      })
      .then((j) => {
        setScript(j.script);
        setChallenge(j.challenge);
        setPhase("intro");
      })
      .catch((e) => fail(`Could not start: ${e.message}`));
  }, [fail]);

  // cleanup camera + timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopWatchdogRef.current) clearTimeout(stopWatchdogRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(levelRafRef.current);
      audioCtxRef.current?.close().catch(() => {});
      wakeRef.current?.release().catch(() => {});
      if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ── Interruption + wake-lock re-acquisition ───────────────────────────────
  // A wake lock is released automatically whenever the page is hidden, so it
  // has to be taken again on return. And if the page was hidden DURING a take,
  // the capture stream was suspended (iOS) or the countdown was throttled to
  // ~1Hz-or-worse (every browser): the footage is no longer a faithful 65s
  // recording, so it must not be passed off as one. Fail honestly instead.
  useEffect(() => {
    const onVisibility = () => {
      const midTake = phaseRef.current === "speak" || phaseRef.current === "still";
      if (document.hidden) {
        if (midTake) {
          interruptedRef.current = true;
          try { recorderRef.current?.stop(); } catch { /* already stopped */ }
          fail(
            "The recording stopped because the screen switched away or locked. " +
            "Phones suspend the camera when that happens, so this take is not usable. " +
            "Set your screen timeout to a couple of minutes, then record again.",
          );
        }
      } else if (midTake && !wakeRef.current) {
        void acquireWake();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [acquireWake, fail]);

  // Leaving the page mid-take throws away a 65-second performance with no
  // warning. The browser only honours this during a real recording.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (phase === "speak" || phase === "still") e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [phase]);

  /** Sample the mic while lining up, so a dead input is caught before the take. */
  const startMeter = useCallback((stream: MediaStream) => {
    cancelAnimationFrame(levelRafRef.current);
    audioCtxRef.current?.close().catch(() => {});
    setMicLevel(0);
    setMicHeard(false);
    if (!stream.getAudioTracks().length) return;
    try {
      const Ctx: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const node = ctx.createAnalyser();
      node.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(node);
      const buf = new Uint8Array(node.fftSize);
      const tick = () => {
        node.getByteTimeDomainData(buf);
        // RMS around the 128 midpoint, scaled so ordinary speech lands near 1.
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / buf.length) / 24);
        setMicLevel(level);
        if (level > 0.12) setMicHeard(true);
        levelRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* the meter is an aid, never a gate on recording */ }
  }, []);

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(levelRafRef.current);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  // Device labels are hidden until permission is granted, so list AFTER the
  // first successful getUserMedia.
  async function listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setCameras(all.filter((d) => d.kind === "videoinput"));
      setMics(all.filter((d) => d.kind === "audioinput"));
    } catch { /* selection is a convenience; never block recording on it */ }
  }

  async function startCamera(opts?: { camera?: string; mic?: string; orient?: "landscape" | "portrait" }) {
    const useCam = opts?.camera ?? cameraId;
    const useMic = opts?.mic ?? micId;
    const useOrient = opts?.orient ?? orientation;
    // Ask the camera for the shape we actually want. Portrait swaps the ideals;
    // browsers honour this on phones and on virtual cams like DroidCam.
    const long = 1920, short = 1080;
    // MOBILE: three things this used to get wrong on a real phone.
    //   1. No facingMode — a phone could open the REAR camera for what is meant
    //      to be a selfie consent video.
    //   2. frameRate had `min: 25`, which is a HARD constraint: a phone that
    //      cannot guarantee 25fps throws OverconstrainedError and the user was
    //      told "access was denied", which is simply untrue and unfixable by them.
    //   3. Any failure reported as a permission problem, hiding the real cause.
    // So: ask for the ideal setup, and if the device cannot meet it, retry with
    // the bare minimum before giving up.
    const ideal: MediaStreamConstraints = {
      video: {
        ...(useCam ? { deviceId: { exact: useCam } } : { facingMode: { ideal: "user" } }),
        width: { ideal: useOrient === "landscape" ? long : short },
        height: { ideal: useOrient === "landscape" ? short : long },
        frameRate: { ideal: 30 },
      },
      audio: {
        ...(useMic ? { deviceId: { exact: useMic } } : {}),
        echoCancellation: true, noiseSuppression: true,
      },
    };
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(ideal);
      } catch (e) {
        // A denied permission must NOT be retried (it would prompt again and
        // still fail); anything else is worth one relaxed attempt.
        const name = (e as DOMException)?.name ?? "";
        if (name === "NotAllowedError" || name === "SecurityError") throw e;
        stream = await navigator.mediaDevices.getUserMedia({
          video: useCam ? { deviceId: { exact: useCam } } : { facingMode: { ideal: "user" } },
          audio: true,
        });
      }
      void listDevices();
      streamRef.current = stream;
      startMeter(stream);
      setPhase("preview");
      requestAnimationFrame(() => {
        if (liveVideoRef.current) {
          liveVideoRef.current.srcObject = stream;
          liveVideoRef.current.play().catch(() => {});
        }
      });
    } catch (e) {
      // Name the ACTUAL problem. "Access denied" sent people to their browser
      // settings when the real cause was no camera, or another app holding it.
      const name = (e as DOMException)?.name ?? "";
      const msg =
        name === "NotAllowedError" || name === "SecurityError"
          ? "Camera and microphone access was blocked. Allow both in your browser, then tap Start camera again."
          : name === "NotFoundError" || name === "DevicesNotFoundError"
            ? "No camera or microphone was found on this device."
            : name === "NotReadableError" || name === "TrackStartError"
              ? "Your camera is already in use by another app. Close it and try again."
              : name === "OverconstrainedError"
                ? "This camera cannot record at the quality we asked for. Try the other camera."
                : "Could not start the camera. Reload the page and try again.";
      fail(msg);
    }
  }

  // COUNTDOWN. Two things this has to get right, and the previous version got
  // both wrong:
  //
  //  1. `onDone` must NOT be called from inside a setState updater. The speak
  //     segment's callback starts the still segment, which calls
  //     setSecondsLeft(30) — but that ran *within* the outer updater, whose
  //     return value (0) was then applied last and clobbered it. The still
  //     countdown therefore began at 0, fired immediately, and the "30 seconds
  //     of stillness" lasted about one second: consent videos came out 36s
  //     instead of 65s, with the replica-training footage missing entirely.
  //
  //  2. Time comes from a deadline, not from counting ticks. Background tabs
  //     and busy phones throttle timers, and a segment that silently runs short
  //     produces footage that does not match what the creator was told to do.
  function runCountdown(seconds: number, onDone: () => void) {
    if (timerRef.current) clearInterval(timerRef.current);
    const deadline = Date.now() + seconds * 1000;
    setSecondsLeft(seconds);
    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        onDone();
      }
    }, 250);
  }

  useEffect(() => {
    if (phase !== "speak") return;
    const el = prompterRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.clientHeight;
    if (distance <= 0) return;            // short script: nothing to crawl
    const LEAD_MS = 2500;                 // time to read the first line at rest
    const TAIL_MS = 2500;                 // and to finish the last one
    const span = SPEAK_SECONDS * 1000 - LEAD_MS - TAIL_MS;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - t0 - LEAD_MS) / span));
      el.scrollTop = distance * p;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  /** Count the creator in, then roll. */
  function beginRecording() {
    if (!streamRef.current) return fail("Camera not ready.");
    setLeadIn(3);
    const tick = setInterval(() => {
      setLeadIn((n) => {
        if (n === null) return null;
        if (n > 1) return n - 1;
        clearInterval(tick);
        // Defer out of the state updater — starting the recorder here would be
        // a side effect during render scheduling.
        setTimeout(() => { setLeadIn(null); startRecorder(); }, 0);
        return null;
      });
    }, 1000);
  }

  /** Assemble the take from whatever chunks exist. Safe to call twice. */
  function finishTake() {
    if (stopWatchdogRef.current) { clearTimeout(stopWatchdogRef.current); stopWatchdogRef.current = null; }
    if (blobRef.current || interruptedRef.current) return;   // already handled, or abandoned
    releaseWake();
    if (!chunksRef.current.length) {
      return fail("The recording came back empty. That is usually the camera being taken over by another app — close it and record again.");
    }
    const blob = new Blob(chunksRef.current, { type: mimeRef.current.mime.split(";")[0] });
    blobRef.current = blob;
    setHasFootage(true);
    setReviewUrl(URL.createObjectURL(blob));
    setPhase("review");
  }

  function startRecorder() {
    const stream = streamRef.current;
    if (!stream) return fail("Camera not ready.");
    chunksRef.current = [];
    durationRef.current = 0;
    const rec = new MediaRecorder(stream, {
      mimeType: mimeRef.current.mime,
      videoBitsPerSecond: 6_000_000,
    });
    rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
    rec.onstop = () => finishTake();
    stopMeter();                      // the analyser is only for lining up
    rec.start(1000);
    recorderRef.current = rec;
    interruptedRef.current = false;
    void acquireWake();
    const started = Date.now();
    setPhase("speak");
    runCountdown(SPEAK_SECONDS, () => {
      setPhase("still");
      runCountdown(STILL_SECONDS, () => {
        durationRef.current = Math.round((Date.now() - started) / 1000);
        try {
          // Flush the tail before stopping — on Safari the final chunk is
          // otherwise the one most likely to go missing.
          if (recorderRef.current?.state === "recording") recorderRef.current.requestData();
          recorderRef.current?.stop();
        } catch { /* fall through to the watchdog */ }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        // If `onstop` never arrives (documented iOS Safari behaviour), build
        // the take ourselves rather than leaving the creator on a dead screen.
        stopWatchdogRef.current = setTimeout(finishTake, 2500);
      });
    });
  }

  function retake() {
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setReviewUrl(null);
    blobRef.current = null;
    setHasFootage(false);
    startCamera();
  }

  async function submit() {
    const blob = blobRef.current;
    if (!blob || !challenge) return fail("Nothing recorded.");
    setPhase("uploading");
    try {
      const path = `${orgId}/consent-${Date.now()}.${mimeRef.current.ext}`;
      const { error: upErr } = await supabaseBrowser()
        .storage.from("consent-videos")
        .upload(path, blob, { contentType: blob.type });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      const res = await fetch("/api/consent/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          video_path: path,
          content_type: blob.type,
          challenge,
          client_duration_s: durationRef.current,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `Submit failed (${res.status})`);
      setResult(j);
      setPhase("done");
    } catch (e) {
      fail((e as Error).message);
    }
  }

  const recording = phase === "speak" || phase === "still";
  const totalPhaseSeconds = phase === "speak" ? SPEAK_SECONDS : STILL_SECONDS;

  // MOBILE BUG (reported from a real phone): the stage was locked to
  // `aspect-video`, so on a 390px-wide screen it was only ~219px tall. Every
  // non-video panel (intro, uploading, done, error) was an `absolute inset-0`
  // overlay inside that box, and the Card clips overflow — so the orientation
  // picker and the "Start camera" button rendered outside the visible area and
  // could not be tapped AT ALL. The 16:9 frame belongs to the video, not to the
  // whole stage: when no video is showing, the panel lays out in normal flow and
  // the stage grows to fit it.
  const showsVideo = phase === "preview" || recording || (phase === "review" && Boolean(reviewUrl));

  // ORIENTATION BUG (reported from a real phone): the stage was hardcoded to
  // `aspect-video`, i.e. 16:9, no matter which orientation was chosen. Picking
  // Portrait 9:16 still produced a landscape box, and `object-cover` then
  // cropped the tall camera stream down to it — so the selector looked broken
  // because visually nothing changed. The frame must follow the choice.
  //
  // A full-width 9:16 box would be ~1.78x the viewport width (≈693px at 390px)
  // and would push every control below the fold. So the portrait frame is sized
  // from its HEIGHT — `h-[58vh]` plus `aspect-[9/16]` yields a true 9:16 box
  // ~275px wide, centred. (Capping a full-width box with `max-h` instead breaks
  // the ratio: the browser keeps width:100% and the frame comes out at ~0.73,
  // which letterboxes the stream rather than framing it.)
  const stageBox = orientation === "portrait"
    ? "mx-auto aspect-[9/16] h-[58vh] sm:h-[70vh] max-w-full"
    : "mx-auto aspect-video w-full";
  const panelBase = showsVideo
    ? "absolute inset-0 flex flex-col items-center justify-center"
    : "flex min-h-[16rem] flex-col items-center justify-center";

  return (
    <div className="grid gap-6">
      {/* Stage */}
      <Card ref={stageRef} className="overflow-hidden scroll-mt-24">
        <CardContent className="p-0">
          <div ref={frameRef}
            className={`relative scroll-mt-32 bg-zinc-950 ${showsVideo ? stageBox : "w-full"}`}>
            {(phase === "preview" || recording) && (
              <video
                ref={liveVideoRef}
                muted
                playsInline
                className="h-full w-full -scale-x-100 object-cover"
              />
            )}
            {phase === "review" && reviewUrl && (
              <video src={reviewUrl} controls playsInline className="h-full w-full object-cover" />
            )}

            {(phase === "loading" || phase === "intro") && (
              <div className={`${panelBase} gap-4 p-6 text-center text-zinc-300`}>
                {phase === "loading" ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : (
                  <>
                    <Camera className="size-8 text-emerald-400" />
                    <div className="max-w-md space-y-1">
                      <p className="font-medium text-zinc-100">One continuous take, two parts</p>
                      <p className="text-sm text-zinc-400">
                        {SPEAK_SECONDS}s reading your consent script (with your verification
                        phrase), then {STILL_SECONDS}s sitting still and silent. This recording
                        is your consent artifact and your replica&apos;s training footage.
                      </p>
                    </div>
                    <div className="mt-1 w-full max-w-md space-y-2 text-left">
                      <label className="block text-xs font-medium text-zinc-400">
                        Orientation — this fixes the shape of every video you ever license
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { v: "landscape", t: "Landscape 16:9", h: "YouTube, web, TV-style ads" },
                          { v: "portrait", t: "Portrait 9:16", h: "Reels, Shorts, Stories" },
                        ] as const).map((o) => (
                          <button key={o.v} type="button" onClick={() => setOrientation(o.v)}
                            aria-pressed={orientation === o.v}
                            className={`rounded-lg border p-2.5 text-left transition-colors ${
                              orientation === o.v
                                ? "border-emerald-500 bg-emerald-500/10"
                                : "border-zinc-700 hover:bg-zinc-900"
                            }`}>
                            <span className="block text-sm font-medium text-zinc-100">{o.t}</span>
                            <span className="block text-xs text-zinc-400">{o.h}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <Button onClick={() => startCamera()} size="lg" className="mt-2 h-12 w-full max-w-xs text-base">
                      <Camera className="size-4" /> Start camera
                    </Button>
                  </>
                )}
              </div>
            )}

            {phase === "uploading" && (
              <div className={`${panelBase} gap-3 bg-zinc-950/90 p-6 text-zinc-200`}>
                <Loader2 className="size-6 animate-spin" />
                <p className="text-sm">Uploading, hashing, and running your voice check…</p>
              </div>
            )}

            {phase === "done" && result && (
              <div className={`${panelBase} gap-4 bg-zinc-950/95 p-6 text-center`}>
                <span className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15">
                  <ShieldCheck className="size-6 text-emerald-400" />
                </span>
                <div className="space-y-1">
                  <p className="font-medium text-zinc-100">Consent recorded in the ledger</p>
                  <p className="mx-auto max-w-md break-all font-mono text-xs text-zinc-400">
                    sha256:{result.content_hash}
                  </p>
                  <p className="text-sm">
                    {result.voice_captcha.verified ? (
                      <span className="text-emerald-400">Voice check: verification phrase confirmed</span>
                    ) : (
                      <span className="text-amber-400">
                        Voice check pending — the spoken phrase couldn&apos;t be confirmed automatically
                      </span>
                    )}
                  </p>
                </div>
                <Button onClick={() => { router.push("/creator"); router.refresh(); }}>
                  Back to studio
                </Button>
              </div>
            )}

            {phase === "error" && (
              <div className={`${panelBase} gap-3 bg-zinc-950/95 p-6 text-center`}>
                <AlertTriangle className="size-6 text-amber-400" />
                <p className="max-w-md text-sm text-zinc-300">{error}</p>
                {/* If the footage survived, NEVER make them perform the whole
                    65-second take again just because an upload blipped. Retry
                    first; discarding is the demoted, confirmed action. */}
                {hasFootage ? (
                  <>
                    <p className="text-xs text-zinc-400">
                      Your recording is safe — you don&apos;t need to film it again.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button onClick={() => submit()}>
                        <RefreshCcw className="size-4" /> Retry upload
                      </Button>
                      <Button variant="ghost" onClick={() => {
                        if (confirm("This discards your recording and starts a new take. Continue?")) location.reload();
                      }}>
                        Record again
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => location.reload()}>
                    <RefreshCcw className="size-4" /> Start over
                  </Button>
                )}
              </div>
            )}

            {/* Lead-in count. */}
            {leadIn !== null && (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/45">
                <span className="text-7xl font-bold tabular-nums text-white drop-shadow-lg">{leadIn}</span>
              </div>
            )}

            {/* Two-segment progress, so the creator can see how much of the read
                is left and that a second part is coming — no surprise switch. */}
            {recording && (
              <div className="absolute inset-x-0 top-0 flex gap-1 p-2">
                {([["Read", "speak", SPEAK_SECONDS], ["Still", "still", STILL_SECONDS]] as const).map(
                  ([label, ph, total]) => {
                    const done = phase === "still" && ph === "speak";
                    const active = phase === ph;
                    const pct = done ? 100 : active ? ((total - secondsLeft) / total) * 100 : 0;
                    return (
                      <div key={label} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
                        <div className="h-full rounded-full bg-white transition-[width] duration-1000 ease-linear"
                          style={{ width: `${pct}%` }} />
                      </div>
                    );
                  },
                )}
              </div>
            )}

            {/* Mic meter, pinned to the frame so it is impossible to miss while
                lining up. A dead mic otherwise costs a full 65-second take. */}
            {phase === "preview" && leadIn === null && (
              <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-zinc-950/90 to-transparent p-3 pt-8"
                   aria-live="polite">
                <div className="mx-auto flex max-w-sm items-center gap-2">
                  <Mic className={`size-4 shrink-0 ${micHeard ? "text-emerald-400" : "text-amber-400"}`} />
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
                    <div
                      className={`h-full rounded-full transition-[width] duration-75 ${micHeard ? "bg-emerald-400" : "bg-amber-400"}`}
                      style={{ width: `${Math.round(micLevel * 100)}%` }}
                    />
                  </div>
                  <span className={`shrink-0 text-[11px] font-medium ${micHeard ? "text-emerald-300" : "text-amber-300"}`}>
                    {micHeard ? "Mic check ok" : "Mic check — say something"}
                  </span>
                </div>
                {!micHeard && (
                  <p className="mx-auto mt-1 max-w-sm text-center text-[11px] text-amber-200/90">
                    No sound yet — check silent mode and any connected headset. The verification
                    phrase has to be heard for this consent to be verified.
                  </p>
                )}
              </div>
            )}

            {/* Framing guide — shown while lining up, hidden once recording so it
                never appears in the footage the reviewer watches back. */}
            {phase === "preview" && leadIn === null && (
              <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-[62%] w-[46%] rounded-[50%] border-2 border-dashed border-emerald-400/50" />
                <p className="absolute left-0 right-0 top-3 z-0 text-balance px-3 text-center text-[11px] font-medium text-emerald-300/90">
                  Line your face up inside the oval · chest-up · eyes level with the lens
                </p>
              </div>
            )}

            {/* Teleprompter. Read verbatim, like HeyGen — so it has to be legible
                at arm's length on a phone, not 14px at the bottom of the frame. */}
            {phase === "speak" && (
              <div
                ref={prompterRef}
                className="absolute inset-x-0 bottom-0 h-[46%] overflow-hidden bg-zinc-950/75 px-4 py-3 backdrop-blur-[2px]"
              >
                <p className="mx-auto max-w-2xl text-center text-[17px] font-semibold leading-snug text-white sm:text-xl">
                  {script}
                </p>
                {/* Bottom padding as a spacer so the final line can crawl clear
                    of the edge rather than stopping flush against it. */}
                <div className="h-10" aria-hidden />
              </div>
            )}
            {phase === "still" && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950 via-zinc-950/85 to-transparent p-5 pt-14 text-center">
                <p className="text-xl font-semibold text-white">Now sit still and stay silent</p>
                <p className="mt-1 text-sm text-zinc-300">Look at the lens · natural expression · <span className="font-semibold text-white">{secondsLeft}s left</span></p>
              </div>
            )}

            {recording && (
              <div className="absolute left-3 top-7 flex items-center gap-2 rounded-full bg-red-600/95 px-3.5 py-2 shadow-lg">
                <Circle className="size-3 animate-pulse fill-white text-white" />
                <span className="text-sm font-semibold tabular-nums text-white">
                  {phase === "speak" ? "READING" : "HOLD STILL"} · {secondsLeft}s
                </span>
              </div>
            )}
          </div>

          {recording && (
            <Progress
              value={((totalPhaseSeconds - secondsLeft) / totalPhaseSeconds) * 100}
              className="h-1 rounded-none"
            />
          )}
        </CardContent>
      </Card>

      {/* Controls / script preview */}
      {phase === "preview" && (
        <div className="grid gap-4">
          <Card>
            <CardContent className="space-y-2 pt-6">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-primary/5 text-primary border-primary/30">
                  <Mic className="size-3.5" /> You will read this aloud
                </Badge>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{script}</p>
            </CardContent>
          </Card>
          {/* Device pickers, like HeyGen's. Arjun records through DroidCam (phone
              as webcam), so defaulting to the built-in laptop camera would quietly
              produce far worse training footage than he has available. */}
          {(cameras.length > 1 || mics.length > 1) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {cameras.length > 1 && (
                <label className="text-xs font-medium text-muted-foreground">
                  Camera
                  <select
                    value={cameraId}
                    onChange={(e) => { setCameraId(e.target.value); startCamera({ camera: e.target.value }); }}
                    className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-sm text-foreground"
                  >
                    {cameras.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
                    ))}
                  </select>
                </label>
              )}
              {mics.length > 1 && (
                <label className="text-xs font-medium text-muted-foreground">
                  Microphone
                  <select
                    value={micId}
                    onChange={(e) => { setMicId(e.target.value); startCamera({ mic: e.target.value }); }}
                    className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-sm text-foreground"
                  >
                    {mics.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Recording in <span className="font-medium text-foreground">
              {orientation === "landscape" ? "landscape (16:9)" : "portrait (9:16)"}
            </span>. Frame yourself chest-up, eyes level with the lens.
            {" "}The second half is {STILL_SECONDS}s of silence — your screen must not lock,
            so set your auto-lock to a few minutes first.
          </p>

          {/* In flow only on roomy viewports; otherwise the pinned bar below. */}
          {!compact && (
          <Button size="lg" onClick={beginRecording} disabled={leadIn !== null}>
            <Circle className="size-4 fill-red-500 text-red-500" /> Start recording ({SPEAK_SECONDS + STILL_SECONDS}s total)
          </Button>
          )}
        </div>
      )}

      {/* Scroll room for the pinned bar. Without it the document bottoms out
          before the bottom of the frame clears the bar. */}
      {compact && phase === "preview" && <div aria-hidden className="h-28" />}

      {/* Sticky shutter. `pb-[env(safe-area-inset-bottom)]` keeps it clear of
          the iOS home indicator, which otherwise sits on top of it. */}
      {phase === "preview" && leadIn === null && compact && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          <Button size="lg" onClick={beginRecording} className="h-14 w-full text-base">
            <Circle className="size-5 fill-red-500 text-red-500" /> Start recording · {SPEAK_SECONDS + STILL_SECONDS}s
          </Button>
        </div>
      )}

      {phase === "review" && (
        <div className="flex flex-col gap-3 pb-24 sm:flex-row lg:pb-0">
          <Button size="lg" className="flex-1" onClick={submit}>
            <UploadCloud className="size-4" /> Looks good — submit to the ledger
          </Button>
          <Button size="lg" variant="outline" className="flex-1" onClick={retake}>
            <RefreshCcw className="size-4" /> Retake
          </Button>
        </div>
      )}
    </div>
  );
}
