# Consentry

A consent-first marketplace for AI video endorsements: a person records consent
on camera, publishes the rules they will not break, and every generated video is
checked against those rules **before** money moves — then ships with a visible AI
label and a cryptographic record of who agreed to what.

Built for the Indian market, where the IT Rules amendments of 2026 require
synthetic media to be labelled but provide no plumbing for proving that a
likeness was licensed in the first place.

> **Status: portfolio snapshot.** This is a working application, not a live
> business. Payments run in test mode, the video engines can be left on a free
> mock, and the actors in the seed data are generated portraits, not real people.
> It is published to show how the system is built.

---

## The problem

Anyone can make a video of a face saying anything. Tools that generate those
videos treat consent as a checkbox at signup, if at all. So there is no way for
the person whose face it is to prove, later, what they actually agreed to — and
no way for a brand to prove it either, when a platform or a regulator asks.

The interesting part is not generating the video. It is everything around it:
the record of consent, the rules attached to it, the enforcement of those rules
before a payment, the approval of each specific video, and a file that carries
its own provenance after it leaves the platform.

## How it works

1. **Consent is recorded, not claimed.** The person reads a scripted phrase on
   camera. The audio is transcribed and matched against the phrase, so the
   recording proves a live human said the words. The video is hashed and stored;
   the hash is what everything else references.
2. **They publish their own rules.** Categories they will work in, and specific
   things they will not say — no medical claims, no betting, no rival brands.
   The rules are public on their page, so a brand knows before writing anything.
3. **The script is judged before payment.** A brand's script is checked against
   the platform's rules and that person's own list. A refusal names the rule it
   broke and quotes the phrase that broke it. Nothing is rendered, and nothing is
   charged.
4. **They approve the specific video.** The master is rendered once into private
   storage; the brand sees only a watermarked preview. A single-use link lets the
   person approve, request changes, or decline from their phone. **Silence is
   never consent** — there is no auto-approve path anywhere, and a test fails the
   build if one is ever added.
5. **The file carries its own proof.** Delivery burns a visible AI label into the
   picture and seals C2PA Content Credentials into the file, tying it back to the
   consent record and the licence. A public page verifies any video, and a
   per-person registry lists every video ever approved — so if it is not on that
   page, they did not approve it.

## Engineering worth looking at

- **Authorization lives in the database.** Row-level security plus
  `SECURITY DEFINER` functions that re-validate the caller. The application layer
  is not trusted to enforce who may read a generation or spend a licence;
  `tests/rls/` proves a second tenant cannot reach the first one's rows.
- **The approval token never reaches the counterparty.** Both parties can read a
  generation, so an early version handed the brand the celebrity's magic link.
  `tests/social-approval.test.ts` is the regression that keeps it shut.
- **Licence terms are snapshotted at purchase.** Tiers reference live rows, and a
  creator can edit a tier at any time, so the terms a brand bought were readable
  out from under them. The licence now carries its own copy.
- **The gate is adversarial.** `tests/policy-injection.test.ts` throws scripts
  that instruct the reviewer rather than the audience, and asserts none of them
  auto-approve.
- **Provenance is verified, not just read.** Reading a C2PA manifest is not the
  same as validating it; `tests/media/tamper-detection.test.ts` flips bytes in a
  signed file and asserts the checker refuses it.
- **Money is integers.** All amounts are `bigint` minor units (paise), and the
  payout ledger reconciles against the wallet.

## Stack

Next.js (App Router) · TypeScript · Supabase (Postgres, RLS, Storage, Auth) ·
Tailwind · Vitest · ffmpeg · C2PA Content Credentials · Anthropic Claude for the
rules engine · Tavus / HeyGen / D-ID as swappable video engines.

Roughly 24k lines across 25 pages, 25 API routes, 26 migrations and 16 test
suites.

## Running it

```bash
npm install
cp .env.example .env.local     # fill in Supabase + ANTHROPIC_API_KEY
npm run dev
```

The only hard requirements are a Supabase project and an Anthropic key for the
script gate. Leave `VIDEO_PROVIDER=mock` and `PAYMENT_PROVIDER=mock` and the
whole loop runs end to end without spending anything — the mock engine still
applies the visible label and the C2PA seal for real.

```bash
npm test                       # unit + RLS + media suites
npm run test:rls               # authorization only
```

Database schema is in `supabase/migrations/`, applied in order.

### Notes

- **No C2PA keys are committed.** Supply `C2PA_CERT_PEM` and `C2PA_KEY_PEM`, or
  the pipeline labels and hashes the file but reports it as unsigned rather than
  pretending otherwise. For local work, c2patool's published ES256 sample pair is
  enough; anything real needs a certificate from a recognised authority.
- **`DEV_OPEN=1` enables a password-free role switcher** at `/api/dev/login` for
  local development. It 404s when `NODE_ENV=production`, and should stay `0`
  anywhere reachable.
- Some copy in this snapshot advertises capabilities — independent deepfake
  screening, for one — that were aspirational at the time and were later cut from
  the deployed product for exactly that reason.

## Licence

No open-source licence is granted. Published for reading, as a portfolio piece.

---

Built by [Shijil Kumar](https://github.com/shijil-kumar).
