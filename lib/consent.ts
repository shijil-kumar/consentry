import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

// ── CONSENT_SCRIPT_V1 (POLICY_AND_CONSENT_SPEC §1.2) ────────────────────────
// The creator reads this on camera. The same recording doubles as the Tavus
// training footage AND (via the spoken challenge) the anti-replay liveness proof.
export const CONSENT_SCRIPT_VERSION = "v1";

export function buildConsentScript(fullName: string, dateISO: string, challengePhrase: string) {
  const platform = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "this platform";
  const date = new Date(dateISO).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    `I, ${fullName}, on ${date}, consent to ${platform} creating a digital replica ` +
    `of my likeness and voice from this recording. I authorize its use to generate ` +
    `endorsement videos only for scripts that I or this platform's rules have approved ` +
    `in advance, under licenses I control. I may revoke this consent at any time, ` +
    `which stops all future video generation. ` +
    `My verification phrase is: ${challengePhrase}.`
  );
}

// v1 scope is fixed (read-only in the UI; a scope editor is roadmap).
export const CONSENT_SCOPE_V1 = {
  commercial_endorsement: true,
  territories: ["IN"],
  channels: ["social", "web"],
  training_other_models: false,
} as const;

// ── Voice-captcha challenge (stateless, HMAC-signed) ────────────────────────
// A fresh spoken phrase proves the recording was made NOW by a live person —
// old footage of the creator can't be replayed through onboarding.
const WORDS = [
  "amber", "river", "copper", "lantern", "meadow", "signal", "harbor", "velvet",
  "cobalt", "summit", "willow", "ember", "falcon", "garnet", "horizon", "juniper",
  "marble", "nectar", "orchid", "prairie", "quartz", "saffron", "timber", "zenith",
];

function hmac(payload: string): string {
  const secret = process.env.CONSENT_CHALLENGE_SECRET;
  if (!secret) throw new Error("CONSENT_CHALLENGE_SECRET missing");
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export interface Challenge {
  phrase: string;     // e.g. "amber falcon 4 7 2"
  issuedAt: number;   // epoch ms
  sig: string;
}

export function issueChallenge(userId: string): Challenge {
  const words = Array.from({ length: 2 }, () => WORDS[randomInt(WORDS.length)]);
  const digits = Array.from({ length: 3 }, () => String(randomInt(10)));
  const phrase = [...words, ...digits].join(" ");
  const issuedAt = Date.now();
  return { phrase, issuedAt, sig: hmac(`${userId}:${phrase}:${issuedAt}`) };
}

const CHALLENGE_TTL_MS = 30 * 60 * 1000; // generous: recording takes a few minutes

export function verifyChallengeSignature(userId: string, c: Challenge): boolean {
  try {
    const expected = Buffer.from(hmac(`${userId}:${c.phrase}:${c.issuedAt}`), "hex");
    const got = Buffer.from(c.sig, "hex");
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return false;
    return Date.now() - c.issuedAt < CHALLENGE_TTL_MS;
  } catch {
    return false;
  }
}

// Fuzzy check: did the transcript contain the challenge? STT drifts, so require
// ≥80% of tokens (digits may transcribe as words — normalize both directions).
const DIGIT_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

export function transcriptMatchesChallenge(transcript: string, phrase: string) {
  // STT often joins spoken digits ("4 7 2" → "472") — expand digit runs so both
  // sides compare digit-by-digit.
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
      .flatMap((t) => {
        const mapped = DIGIT_WORDS[t] ?? t;
        return /^\d{2,}$/.test(mapped) ? mapped.split("") : [mapped];
      });
  const haystack = new Set(normalize(transcript));
  const needles = normalize(phrase);
  const hits = needles.filter((n) => haystack.has(n)).length;
  return { matched: hits / needles.length >= 0.8, hits, total: needles.length };
}
