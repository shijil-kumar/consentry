-- (applied live 2026-07-27) Desktop -> phone handoff for consent recording,
-- modelled on HeyGen's "Record via phone" QR. A creator's laptop webcam is
-- usually the worst camera they own; the phone is the best, and this recording
-- is what their AI likeness is trained from.
--
-- Same security shape as approval_tokens: the token IS the credential, so the
-- table is service-role only (RLS on, deliberately NO policies), single-use,
-- and short-lived. Scanning exchanges it for a real Supabase session, so every
-- downstream control (storage RLS, signed challenge, submit_consent role check)
-- applies unchanged.
create table if not exists consent_handoff_tokens (
  token       text primary key,
  creator_id  uuid not null references profiles(id) on delete cascade,
  org_id      uuid not null references orgs(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
alter table consent_handoff_tokens enable row level security;
revoke all on consent_handoff_tokens from anon, authenticated;
create index if not exists cht_creator_idx on consent_handoff_tokens(creator_id, used_at);
