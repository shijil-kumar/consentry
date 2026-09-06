-- ════════════════════════════════════════════════════════════════════════
-- 0001_init.sql — ENTIRE schema + RLS for <PLATFORM_NAME> (Consent First)
-- Source of truth: consent-marketplace-plan/DATA_MODEL.md
-- RLS is enabled on EVERY table in this file. All state transitions go
-- through SECURITY DEFINER RPCs (grant matrix at the bottom).
-- ════════════════════════════════════════════════════════════════════════

-- §0 Extensions ────────────────────────────────────────────────────────────
-- pgcrypto lives in the `extensions` schema on Supabase. Every SECURITY
-- DEFINER function that hashes sets search_path = public, extensions.
create extension if not exists pgcrypto with schema extensions;

-- §1 Enums ─────────────────────────────────────────────────────────────────
create type org_type          as enum ('creator','brand','platform');
create type user_role         as enum ('creator','buyer','admin');
create type consent_status    as enum ('pending','verified','revoked');
create type avatar_status     as enum ('training','ready','failed','disabled');
create type listing_status    as enum ('draft','published','suspended');
create type exclusivity_kind  as enum ('none','category','full');
create type request_status    as enum ('pending_check','auto_approved','needs_review','approved','rejected','expired');
create type license_status    as enum ('payment_pending','active','expired','revoked'); -- 'revoked' reserved for roadmap
create type generation_status as enum ('queued','generating','processing','delivered','failed','blocked');
create type payout_status     as enum ('mock_pending','mock_paid');

-- §2 Core tables: orgs + profiles ─────────────────────────────────────────
create table orgs (
  id         uuid primary key default gen_random_uuid(),
  type       org_type not null,
  name       text not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  org_id       uuid not null references orgs(id),
  role         user_role not null,
  display_name text not null,
  handle       text unique,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- RLS helpers (SECURITY DEFINER so they read profiles without recursion)
create or replace function auth_org_id() returns uuid
language sql stable security definer set search_path = public as
$$ select org_id from profiles where id = auth.uid() $$;

create or replace function auth_role() returns user_role
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() $$;

alter table orgs enable row level security;
alter table profiles enable row level security;

create policy orgs_select on orgs for select to authenticated
  using (id = auth_org_id() or auth_role() = 'admin');

create policy profiles_select_own_org on profiles for select to authenticated
  using (org_id = auth_org_id() or auth_role() = 'admin');

create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid()
              and role   = (select role   from profiles p2 where p2.id = auth.uid())
              and org_id = (select org_id from profiles p2 where p2.id = auth.uid()));

-- Column-level lock: role and org_id are not client-updatable AT ALL
-- (an org_id swap would hijack another org's entire RLS surface).
revoke insert, update, delete on orgs     from anon, authenticated;
revoke insert, update, delete on profiles from anon, authenticated;
grant  update (display_name, handle, avatar_url) on profiles to authenticated;

-- Signup bootstrap: personal org + profile. Role comes from signup metadata;
-- 'admin' is NEVER self-assignable (seeded manually later).
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role;
  v_org  uuid;
  v_name text;
begin
  v_role := case when new.raw_user_meta_data->>'role' = 'creator'
                 then 'creator'::user_role else 'buyer'::user_role end;
  v_name := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
                     split_part(coalesce(new.email, 'user'), '@', 1));
  insert into orgs (type, name)
  values (case when v_role = 'creator' then 'creator'::org_type else 'brand'::org_type end, v_name)
  returning id into v_org;
  begin
    insert into profiles (id, org_id, role, display_name, handle)
    values (new.id, v_org, v_role, v_name, nullif(trim(new.raw_user_meta_data->>'handle'), ''));
  exception when unique_violation then
    -- handle collision must never break signup; creator can pick a handle later
    insert into profiles (id, org_id, role, display_name, handle)
    values (new.id, v_org, v_role, v_name, null);
  end;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- §3 Consent ledger (crown jewel) ─────────────────────────────────────────
create table consent_records (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references orgs(id),
  creator_id             uuid not null references profiles(id),
  consent_video_path     text not null,
  content_hash           text not null,
  consent_script_version text not null,
  scope                  jsonb not null,
  status                 consent_status not null default 'pending',
  granted_at             timestamptz not null default now(),
  verified_at            timestamptz,
  revoked_at             timestamptz,
  revocation_reason      text,
  created_at             timestamptz not null default now(),
  constraint revoked_needs_ts check (status <> 'revoked' or revoked_at is not null)
);

alter table consent_records enable row level security;

create policy consent_select_own on consent_records for select to authenticated
  using (org_id = auth_org_id() or auth_role() = 'admin');
-- No client INSERT policy: rows are born via submit_consent() so hashing +
-- audit are atomic. NO update/delete policies EVER — the ledger never forgets.
revoke insert, update, delete on consent_records from anon, authenticated;

-- §4 Avatars ───────────────────────────────────────────────────────────────
create table avatars (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id),
  creator_id          uuid not null references profiles(id),
  consent_record_id   uuid not null references consent_records(id),
  provider            text not null default 'tavus',
  provider_replica_id text,   -- Tavus face_id
  status              avatar_status not null default 'training',
  preview_video_url   text,
  error               text,
  created_at          timestamptz not null default now(),
  unique (provider, provider_replica_id)
);

alter table avatars enable row level security;

create policy avatars_select_own on avatars for select to authenticated
  using (org_id = auth_org_id() or auth_role() = 'admin');

create policy avatars_insert_own on avatars for insert to authenticated
  with check (org_id = auth_org_id() and creator_id = auth.uid() and status = 'training'
              and exists (select 1 from consent_records c
                          where c.id = consent_record_id
                            and c.creator_id = auth.uid()
                            and c.status in ('pending','verified')));
-- training→ready|failed via service RPCs; ready→disabled only via revoke cascade.
revoke update, delete on avatars from anon, authenticated;

-- §5 Policy clause catalog ────────────────────────────────────────────────
create table policy_clauses (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  title       text not null,
  description text not null,          -- exact wording the buyer sees when blocked
  keywords    text[] not null default '{}',
  is_platform boolean not null default false,  -- true = always-on Layer 0, not togglable
  default_on  boolean not null default true,
  sort_order  int not null default 0
);

alter table policy_clauses enable row level security;
create policy clauses_public_read on policy_clauses for select to anon, authenticated
  using (true);
revoke insert, update, delete on policy_clauses from anon, authenticated;

-- §6 Listings + prohibited uses + tiers ───────────────────────────────────
create table listings (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references orgs(id),
  creator_id         uuid not null references profiles(id),
  avatar_id          uuid not null references avatars(id),
  title              text not null,
  bio                text,
  allowed_categories text[] not null default '{}',
  status             listing_status not null default 'draft',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table listing_prohibited_uses (
  listing_id  uuid not null references listings(id) on delete cascade,
  clause_id   uuid not null references policy_clauses(id),
  custom_note text,
  primary key (listing_id, clause_id)
);

create table license_tiers (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id),
  listing_id      uuid not null references listings(id) on delete cascade,
  name            text not null,
  price_paise     bigint not null check (price_paise > 0),
  duration_days   int not null check (duration_days > 0),
  exclusivity     exclusivity_kind not null default 'none',
  max_generations int not null default 1 check (max_generations > 0),
  sort_order      int not null default 0
);

-- Publishing gate: only ready avatar + verified consent + same org + >=1 tier
create or replace function enforce_publishable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    if not exists (
      select 1 from avatars a
      join consent_records c on c.id = a.consent_record_id
      where a.id = new.avatar_id
        and a.status = 'ready'
        and a.org_id = new.org_id
        and c.status = 'verified'
    ) then
      raise exception 'PUBLISH:avatar_not_ready_or_consent_not_verified';
    end if;
    if not exists (select 1 from license_tiers t where t.listing_id = new.id) then
      raise exception 'PUBLISH:no_tiers';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger listings_publish_gate before update on listings
  for each row execute function enforce_publishable();

-- Platform clauses apply implicitly to every listing — never row-attached
create or replace function lpu_platform_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from policy_clauses c where c.id = new.clause_id and c.is_platform) then
    raise exception 'LPU:platform_clauses_are_implicit';
  end if;
  return new;
end $$;

create trigger lpu_guard before insert or update on listing_prohibited_uses
  for each row execute function lpu_platform_guard();

alter table listings enable row level security;
alter table listing_prohibited_uses enable row level security;
alter table license_tiers enable row level security;

create policy listings_select on listings for select to anon, authenticated
  using (status = 'published' or org_id = auth_org_id() or auth_role() = 'admin');

create policy listings_insert_own on listings for insert to authenticated
  with check (org_id = auth_org_id() and creator_id = auth.uid() and status = 'draft'
              and exists (select 1 from avatars a where a.id = avatar_id
                          and a.org_id = auth_org_id() and a.creator_id = auth.uid()));

create policy listings_update_own on listings for update to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id()
              and exists (select 1 from avatars a where a.id = avatar_id
                          and a.org_id = auth_org_id() and a.creator_id = auth.uid()));

create policy lpu_select on listing_prohibited_uses for select to anon, authenticated
  using (exists (select 1 from listings l where l.id = listing_id
                 and (l.status = 'published' or l.org_id = auth_org_id())));

create policy lpu_all_own on listing_prohibited_uses for all to authenticated
  using (exists (select 1 from listings l where l.id = listing_id and l.org_id = auth_org_id()))
  with check (exists (select 1 from listings l where l.id = listing_id and l.org_id = auth_org_id()));

create policy tiers_select on license_tiers for select to anon, authenticated
  using (exists (select 1 from listings l where l.id = listing_id
                 and (l.status = 'published' or l.org_id = auth_org_id())));

create policy tiers_all_own on license_tiers for all to authenticated
  using (org_id = auth_org_id()
         and exists (select 1 from listings l where l.id = listing_id and l.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
              and exists (select 1 from listings l where l.id = listing_id and l.org_id = auth_org_id()));

-- §7 Approval requests (the pre-payment gate) ─────────────────────────────
create table approval_requests (
  id             uuid primary key default gen_random_uuid(),
  buyer_org_id   uuid not null references orgs(id),
  buyer_id       uuid not null references profiles(id),
  creator_org_id uuid not null references orgs(id),
  listing_id     uuid not null references listings(id),
  tier_id        uuid not null references license_tiers(id),
  category       text not null,
  script         text not null check (char_length(script) between 20 and 2000),
  script_hash    text not null default '',
  brief_notes    text,
  policy_report  jsonb,
  status         request_status not null default 'pending_check',
  decided_by     uuid references profiles(id),
  decided_at     timestamptz,
  expires_at     timestamptz not null default now() + interval '7 days',
  created_at     timestamptz not null default now()
);

-- Server-computed fields: script_hash is ALWAYS re-derived (client value
-- ignored) and creator_org_id is copied from the listing (client can't lie).
create or replace function set_request_defaults() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  new.script_hash := encode(digest(new.script, 'sha256'), 'hex');
  select l.org_id into new.creator_org_id from listings l where l.id = new.listing_id;
  return new;
end $$;

create trigger approval_requests_defaults before insert on approval_requests
  for each row execute function set_request_defaults();

alter table approval_requests enable row level security;

create policy req_select_parties on approval_requests for select to authenticated
  using (buyer_org_id = auth_org_id() or creator_org_id = auth_org_id() or auth_role() = 'admin');

create policy req_insert_buyer on approval_requests for insert to authenticated
  with check (buyer_org_id = auth_org_id() and buyer_id = auth.uid()
              and status = 'pending_check' and policy_report is null
              and decided_by is null and decided_at is null
              and exists (select 1 from listings l where l.id = listing_id and l.status = 'published')
              and exists (select 1 from license_tiers t where t.id = tier_id and t.listing_id = listing_id));
-- No client UPDATE: verdicts via apply_policy_verdict(), decisions via decide_request().
revoke update, delete on approval_requests from anon, authenticated;

-- §8 Licenses (money ledger) ──────────────────────────────────────────────
create table licenses (
  id                  uuid primary key default gen_random_uuid(),
  request_id          uuid unique not null references approval_requests(id),
  buyer_org_id        uuid not null references orgs(id),
  creator_org_id      uuid not null references orgs(id),
  listing_id          uuid not null references listings(id),
  tier_id             uuid not null references license_tiers(id),
  status              license_status not null default 'payment_pending',
  amount_paise        bigint not null,
  currency            text not null default 'INR',
  razorpay_order_id   text unique,
  razorpay_payment_id text unique,
  starts_at           timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz not null default now()
);

alter table licenses enable row level security;

create policy lic_select_parties on licenses for select to authenticated
  using (buyer_org_id = auth_org_id() or creator_org_id = auth_org_id() or auth_role() = 'admin');
revoke insert, update, delete on licenses from anon, authenticated;

-- §9 Generations — rows can ONLY be born through create_generation() ──────
create table generations (
  id                uuid primary key default gen_random_uuid(),
  license_id        uuid not null references licenses(id),
  request_id        uuid not null references approval_requests(id),
  buyer_org_id      uuid not null references orgs(id),
  creator_org_id    uuid not null references orgs(id),
  provider          text not null default 'tavus',
  provider_video_id text,
  script            text not null,
  script_hash       text not null,
  status            generation_status not null default 'queued',
  raw_output_url    text,           -- unwatermarked provider output; never exposed to clients
  output_path       text,           -- watermarked + signed final in `deliverables`
  c2pa_manifest     jsonb,
  watermarked       boolean not null default false,
  error             text,
  delivered_at      timestamptz,
  created_at        timestamptz not null default now()
);

alter table generations enable row level security;

create policy gen_select_parties on generations for select to authenticated
  using (buyer_org_id = auth_org_id() or creator_org_id = auth_org_id() or auth_role() = 'admin');
revoke insert, update, delete on generations from anon, authenticated;

-- THE GATE. Six checks inside Postgres; there is no other INSERT path.
create or replace function create_generation(p_license_id uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_lic     licenses%rowtype;
  v_req     approval_requests%rowtype;
  v_consent consent_records%rowtype;
  v_avatar  avatars%rowtype;
  v_tier    license_tiers%rowtype;
  v_count   int;
  v_id      uuid;
begin
  select * into v_lic from licenses where id = p_license_id for update;
  if not found then raise exception 'GATE:license_not_found'; end if;
  -- 1. caller must be the buyer on this license
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.org_id = v_lic.buyer_org_id)
    then raise exception 'GATE:not_buyer'; end if;
  -- 2. license active and inside its window
  if v_lic.status <> 'active' or now() > v_lic.expires_at
    then raise exception 'GATE:license_not_active'; end if;
  -- 3. approval granted and script untampered (re-hash; never trust the stored hash)
  select * into v_req from approval_requests where id = v_lic.request_id;
  if v_req.status not in ('auto_approved','approved') then raise exception 'GATE:not_approved'; end if;
  if encode(digest(v_req.script, 'sha256'), 'hex') <> v_req.script_hash
    then raise exception 'GATE:script_tampered'; end if;
  -- 4. consent still VERIFIED at this exact moment
  select c.* into v_consent
  from consent_records c
  join avatars a on a.consent_record_id = c.id
  join listings l on l.avatar_id = a.id
  where l.id = v_lic.listing_id;
  if not found or v_consent.status <> 'verified' then raise exception 'GATE:consent_revoked'; end if;
  -- 5. avatar ready
  select a.* into v_avatar from avatars a join listings l on l.avatar_id = a.id where l.id = v_lic.listing_id;
  if v_avatar.status <> 'ready' then raise exception 'GATE:avatar_unavailable'; end if;
  -- 6. tier generation quota (serialized by the FOR UPDATE lock above)
  select * into v_tier from license_tiers where id = v_lic.tier_id;
  select count(*) into v_count from generations where license_id = v_lic.id and status <> 'failed';
  if v_count >= v_tier.max_generations then raise exception 'GATE:quota_exhausted'; end if;
  -- birth + audit in the same transaction
  insert into generations (license_id, request_id, buyer_org_id, creator_org_id,
                           provider, script, script_hash, status)
  values (v_lic.id, v_req.id, v_lic.buyer_org_id, v_lic.creator_org_id,
          v_avatar.provider, v_req.script, v_req.script_hash, 'queued')
  returning id into v_id;
  perform append_audit(auth.uid(), 'generation.queued', 'generations', v_id,
                       jsonb_build_object('license_id', v_lic.id,
                                          'buyer_org_id', v_lic.buyer_org_id,
                                          'creator_org_id', v_lic.creator_org_id));
  return v_id;
end $$;

-- §10 Audit log (hash-chained, append-only) ───────────────────────────────
create table audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid,
  actor_org_id uuid,
  action       text not null,
  target_table text not null,
  target_id    uuid,
  meta         jsonb not null default '{}',
  prev_hash    text not null,
  row_hash     text not null,
  created_at   timestamptz not null default now()
);

alter table audit_log enable row level security;

create policy audit_select_parties on audit_log for select to authenticated
  using (actor_org_id = auth_org_id()
         or (meta->>'creator_org_id') = auth_org_id()::text
         or (meta->>'buyer_org_id')  = auth_org_id()::text
         or auth_role() = 'admin');

create or replace function raise_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_immutable before update or delete on audit_log
  for each row execute function raise_immutable();

-- Explicit: not even service_role may rewrite history (trigger catches the rest)
revoke insert, update, delete on audit_log from anon, authenticated;
revoke update, delete on audit_log from service_role;

-- Chain writer. Genesis prev_hash = 64 zero chars. Advisory lock serializes.
create or replace function append_audit(p_actor uuid, p_action text, p_target_table text,
                                        p_target_id uuid, p_meta jsonb default '{}')
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare
  v_prev text;
  v_hash text;
  v_ts   timestamptz := clock_timestamp();
  v_org  uuid;
  v_id   bigint;
begin
  perform pg_advisory_xact_lock(hashtext('audit_log_chain'));
  select row_hash into v_prev from audit_log order by id desc limit 1;
  if v_prev is null then v_prev := repeat('0', 64); end if;
  select org_id into v_org from profiles where id = p_actor;
  v_hash := encode(digest(
    v_prev || p_action || coalesce(p_target_table, '') || coalesce(p_target_id::text, '')
           || coalesce(p_meta::text, '{}') || v_ts::text, 'sha256'), 'hex');
  insert into audit_log (actor_id, actor_org_id, action, target_table, target_id,
                         meta, prev_hash, row_hash, created_at)
  values (p_actor, v_org, p_action, p_target_table, p_target_id,
          coalesce(p_meta, '{}'), v_prev, v_hash, v_ts)
  returning id into v_id;
  return v_id;
end $$;

-- §11 Payouts (READ-ONLY MOCK; inserted only by activate_license) ─────────
create table payouts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references orgs(id),
  license_id         uuid unique not null references licenses(id),
  gross_paise        bigint not null,
  platform_fee_paise bigint not null,
  net_paise          bigint not null,
  status             payout_status not null default 'mock_pending',
  created_at         timestamptz not null default now()
);

alter table payouts enable row level security;
create policy payouts_select_own on payouts for select to authenticated
  using (org_id = auth_org_id() or auth_role() = 'admin');
revoke insert, update, delete on payouts from anon, authenticated;

-- §12 Webhook events (idempotency + forensic ledger) ──────────────────────
create table webhook_events (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,
  external_id     text not null,   -- razorpay: event id · tavus: token:entity:refetched_status
  event_type      text not null,
  payload         jsonb not null,
  signature_valid boolean not null,
  processed_at    timestamptz,
  error           text,
  created_at      timestamptz not null default now(),
  unique (provider, external_id)
);

alter table webhook_events enable row level security;
create policy webhooks_admin_read on webhook_events for select to authenticated
  using (auth_role() = 'admin');
revoke insert, update, delete on webhook_events from anon, authenticated;

-- §13 RPC surface (grant matrix in §16) ───────────────────────────────────

create or replace function submit_consent(p_video_path text, p_hash text,
                                          p_scope jsonb, p_script_version text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_profile profiles%rowtype; v_id uuid;
begin
  select * into v_profile from profiles where id = auth.uid();
  if not found or v_profile.role <> 'creator' then raise exception 'CONSENT:not_a_creator'; end if;
  insert into consent_records (org_id, creator_id, consent_video_path, content_hash,
                               consent_script_version, scope)
  values (v_profile.org_id, v_profile.id, p_video_path, p_hash, p_script_version, p_scope)
  returning id into v_id;
  perform append_audit(auth.uid(), 'consent.granted', 'consent_records', v_id,
                       jsonb_build_object('creator_org_id', v_profile.org_id, 'content_hash', p_hash));
  return v_id;
end $$;

create or replace function mark_consent_verified(p_consent_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v consent_records%rowtype;
begin
  select * into v from consent_records where id = p_consent_id for update;
  if not found then raise exception 'CONSENT:not_found'; end if;
  if v.status = 'verified' then return; end if;  -- idempotent
  if v.status <> 'pending' then raise exception 'CONSENT:not_pending'; end if;
  update consent_records set status = 'verified', verified_at = now() where id = p_consent_id;
  perform append_audit(null, 'consent.verified', 'consent_records', p_consent_id,
                       jsonb_build_object('creator_org_id', v.org_id));
end $$;

create or replace function mark_avatar_ready(p_avatar_id uuid, p_provider_replica_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v avatars%rowtype;
begin
  select * into v from avatars where id = p_avatar_id for update;
  if not found then raise exception 'AVATAR:not_found'; end if;
  if v.status = 'ready' then return; end if;  -- idempotent
  if v.status <> 'training' then raise exception 'AVATAR:not_training'; end if;
  update avatars set status = 'ready', provider_replica_id = p_provider_replica_id, error = null
  where id = p_avatar_id;
  perform append_audit(null, 'avatar.ready', 'avatars', p_avatar_id,
                       jsonb_build_object('creator_org_id', v.org_id));
end $$;

create or replace function mark_avatar_failed(p_avatar_id uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare v avatars%rowtype;
begin
  select * into v from avatars where id = p_avatar_id for update;
  if not found then raise exception 'AVATAR:not_found'; end if;
  if v.status <> 'training' then return; end if;  -- idempotent-ish: only training can fail
  update avatars set status = 'failed', error = p_error where id = p_avatar_id;
  perform append_audit(null, 'avatar.failed', 'avatars', p_avatar_id,
                       jsonb_build_object('creator_org_id', v.org_id, 'error', p_error));
end $$;

create or replace function revoke_consent(p_consent_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v consent_records%rowtype; v_avatars int; v_listings int; v_gens int;
begin
  select * into v from consent_records where id = p_consent_id for update;
  if not found then raise exception 'CONSENT:not_found'; end if;
  if v.creator_id <> auth.uid() then raise exception 'CONSENT:not_owner'; end if;
  if v.status = 'revoked' then return; end if;  -- idempotent
  update consent_records
     set status = 'revoked', revoked_at = now(), revocation_reason = p_reason
   where id = p_consent_id;
  update avatars set status = 'disabled' where consent_record_id = p_consent_id
    and status <> 'disabled';
  get diagnostics v_avatars = row_count;
  update listings l set status = 'suspended', updated_at = now()
    from avatars a
   where a.id = l.avatar_id and a.consent_record_id = p_consent_id
     and l.status <> 'suspended';
  get diagnostics v_listings = row_count;
  update generations g set status = 'blocked'
    from licenses lic
    join listings l on l.id = lic.listing_id
    join avatars a on a.id = l.avatar_id
   where g.license_id = lic.id and a.consent_record_id = p_consent_id
     and g.status in ('queued','generating');
  get diagnostics v_gens = row_count;
  perform append_audit(auth.uid(), 'consent.revoked', 'consent_records', p_consent_id,
    jsonb_build_object('creator_org_id', v.org_id, 'reason', p_reason,
                       'avatars_disabled', v_avatars, 'listings_suspended', v_listings,
                       'generations_blocked', v_gens));
end $$;

create or replace function apply_policy_verdict(p_request_id uuid, p_report jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v approval_requests%rowtype; v_new request_status; v_action text;
begin
  select * into v from approval_requests where id = p_request_id for update;
  if not found then raise exception 'REQUEST:not_found'; end if;
  if v.status <> 'pending_check' then raise exception 'REQUEST:not_pending_check'; end if;
  v_new := case p_report->>'outcome'
             when 'auto_approved' then 'auto_approved'::request_status
             when 'rejected'      then 'rejected'::request_status
             else 'needs_review'::request_status   -- fail-closed default
           end;
  v_action := case v_new when 'auto_approved' then 'request.auto_approved'
                         when 'rejected'      then 'request.rejected'
                         else 'request.needs_review' end;
  update approval_requests
     set status = v_new,
         policy_report = p_report,
         decided_at = case when v_new in ('auto_approved','rejected') then now() end
   where id = p_request_id;
  perform append_audit(null, v_action, 'approval_requests', p_request_id,
    jsonb_build_object('buyer_org_id', v.buyer_org_id, 'creator_org_id', v.creator_org_id));
end $$;

create or replace function decide_request(p_request_id uuid, p_decision text,
                                          p_clause_code text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v approval_requests%rowtype; v_new request_status;
begin
  select * into v from approval_requests where id = p_request_id for update;
  if not found then raise exception 'REQUEST:not_found'; end if;
  if not exists (select 1 from listings l join profiles p on p.id = auth.uid()
                 where l.id = v.listing_id and l.org_id = p.org_id and l.creator_id = p.id)
    then raise exception 'REQUEST:not_listing_owner'; end if;
  if v.status <> 'needs_review' then raise exception 'REQUEST:not_in_review'; end if;
  if p_decision = 'approved' then v_new := 'approved';
  elsif p_decision = 'rejected' then
    if p_clause_code is null
       or not exists (select 1 from policy_clauses c where c.code = p_clause_code)
      then raise exception 'REQUEST:rejection_requires_clause'; end if;
    v_new := 'rejected';
  else
    raise exception 'REQUEST:invalid_decision';
  end if;
  update approval_requests
     set status = v_new,
         decided_by = auth.uid(),
         decided_at = now(),
         policy_report = coalesce(policy_report, '{}'::jsonb)
           || jsonb_build_object('manual_decision', jsonb_build_object(
                'decision', p_decision, 'clause_code', p_clause_code,
                'note', p_note, 'decided_at', now()))
   where id = p_request_id;
  perform append_audit(auth.uid(),
    case v_new when 'approved' then 'request.approved_manual' else 'request.rejected_manual' end,
    'approval_requests', p_request_id,
    jsonb_build_object('buyer_org_id', v.buyer_org_id, 'creator_org_id', v.creator_org_id,
                       'clause_code', p_clause_code));
end $$;

create or replace function begin_checkout(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v approval_requests%rowtype; v_tier license_tiers%rowtype; v_existing licenses%rowtype; v_id uuid;
begin
  select * into v from approval_requests where id = p_request_id for update;
  if not found then raise exception 'CHECKOUT:request_not_found'; end if;
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.org_id = v.buyer_org_id)
    then raise exception 'CHECKOUT:not_buyer'; end if;
  if v.status not in ('auto_approved','approved') then raise exception 'CHECKOUT:not_approved'; end if;
  if now() > v.expires_at then raise exception 'CHECKOUT:request_expired'; end if;
  select * into v_existing from licenses where request_id = p_request_id;
  if found then
    if v_existing.status = 'payment_pending' then return v_existing.id; end if;  -- idempotent retry
    raise exception 'CHECKOUT:license_exists';
  end if;
  select * into v_tier from license_tiers where id = v.tier_id;
  insert into licenses (request_id, buyer_org_id, creator_org_id, listing_id, tier_id,
                        status, amount_paise)
  values (p_request_id, v.buyer_org_id, v.creator_org_id, v.listing_id, v.tier_id,
          'payment_pending', v_tier.price_paise)
  returning id into v_id;
  perform append_audit(auth.uid(), 'license.payment_pending', 'licenses', v_id,
    jsonb_build_object('buyer_org_id', v.buyer_org_id, 'creator_org_id', v.creator_org_id,
                       'amount_paise', v_tier.price_paise));
  return v_id;
end $$;

create or replace function activate_license(p_license_id uuid, p_rzp_payment_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v licenses%rowtype; v_tier license_tiers%rowtype; v_fee bigint;
begin
  select * into v from licenses where id = p_license_id for update;
  if not found then raise exception 'LICENSE:not_found'; end if;
  if v.status = 'active' then return; end if;  -- idempotent: payment.captured AND order.paid both fire
  if v.status <> 'payment_pending' then raise exception 'LICENSE:not_payment_pending'; end if;
  select * into v_tier from license_tiers where id = v.tier_id;
  update licenses
     set status = 'active',
         razorpay_payment_id = p_rzp_payment_id,
         starts_at = now(),
         expires_at = now() + make_interval(days => v_tier.duration_days)
   where id = p_license_id;
  v_fee := round(v.amount_paise * 0.15);
  insert into payouts (org_id, license_id, gross_paise, platform_fee_paise, net_paise)
  values (v.creator_org_id, v.id, v.amount_paise, v_fee, v.amount_paise - v_fee);
  perform append_audit(null, 'license.activated', 'licenses', p_license_id,
    jsonb_build_object('buyer_org_id', v.buyer_org_id, 'creator_org_id', v.creator_org_id,
                       'razorpay_payment_id', p_rzp_payment_id));
end $$;

create or replace function complete_generation(p_generation_id uuid, p_output_path text, p_manifest jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v generations%rowtype;
begin
  select * into v from generations where id = p_generation_id for update;
  if not found then raise exception 'GENERATION:not_found'; end if;
  if v.status = 'delivered' then return; end if;  -- idempotent
  if v.status <> 'processing' then raise exception 'GENERATION:not_processing'; end if;
  update generations
     set status = 'delivered', output_path = p_output_path, c2pa_manifest = p_manifest,
         watermarked = true, delivered_at = now()
   where id = p_generation_id;
  perform append_audit(null, 'generation.delivered', 'generations', p_generation_id,
    jsonb_build_object('buyer_org_id', v.buyer_org_id, 'creator_org_id', v.creator_org_id));
end $$;

-- Public verify path (screen 12 / demo beat 4): exposes ONLY the ledger
-- cross-check fields for DELIVERED generations. No script text, no paths.
create or replace function verify_generation(p_generation_id uuid)
returns table (
  generation_id       uuid,
  script_sha256       text,
  consent_record_hash text,
  consent_status      consent_status,
  license_id          uuid,
  license_expires_at  timestamptz,
  creator_handle      text,
  creator_name        text,
  buyer_org_name      text,
  delivered_at        timestamptz,
  c2pa_manifest       jsonb
) language sql stable security definer set search_path = public as $$
  select g.id, g.script_hash, c.content_hash, c.status,
         lic.id, lic.expires_at, p.handle, p.display_name, o.name,
         g.delivered_at, g.c2pa_manifest
  from generations g
  join licenses lic on lic.id = g.license_id
  join listings l on l.id = lic.listing_id
  join profiles p on p.id = l.creator_id
  join orgs o on o.id = lic.buyer_org_id
  join avatars a on a.id = l.avatar_id
  join consent_records c on c.id = a.consent_record_id
  where g.id = p_generation_id and g.status = 'delivered'
$$;

-- §14 Views ────────────────────────────────────────────────────────────────
create view public_listings as
select l.id, l.title, l.bio, l.allowed_categories,
       p.display_name, p.handle, p.avatar_url,
       a.preview_video_url,
       (c.status = 'verified') as consent_verified,
       c.verified_at as consent_verified_at
from listings l
join profiles p on p.id = l.creator_id
join avatars a on a.id = l.avatar_id
join consent_records c on c.id = a.consent_record_id
where l.status = 'published';

create view public_creators as
select distinct p.id as creator_id, p.display_name, p.handle, p.avatar_url
from profiles p
join listings l on l.creator_id = p.id
where l.status = 'published';

create view public_listing_tiers as
select t.id, t.listing_id, t.name, t.price_paise, t.duration_days,
       t.exclusivity, t.max_generations, t.sort_order
from license_tiers t
join listings l on l.id = t.listing_id
where l.status = 'published';

create view public_listing_rules as
select u.listing_id, c.code, c.title, c.description, u.custom_note
from listing_prohibited_uses u
join policy_clauses c on c.id = u.clause_id
join listings l on l.id = u.listing_id
where l.status = 'published';

-- License-party identity view: buyers keep creator identity + consent status
-- on their licenses even after revocation suspends the listing (demo beat 5).
create view license_details as
select lic.id as license_id, lic.status, lic.starts_at, lic.expires_at,
       lic.amount_paise, lic.buyer_org_id, lic.creator_org_id,
       lic.request_id, lic.tier_id, lic.listing_id,
       l.title as listing_title, t.name as tier_name, t.max_generations,
       p.display_name as creator_name, p.handle as creator_handle, p.avatar_url as creator_avatar_url,
       ob.name as buyer_org_name,
       (c.status = 'verified') as consent_verified, c.status as consent_status
from licenses lic
join listings l on l.id = lic.listing_id
join license_tiers t on t.id = lic.tier_id
join profiles p on p.id = l.creator_id
join orgs ob on ob.id = lic.buyer_org_id
join avatars a on a.id = l.avatar_id
join consent_records c on c.id = a.consent_record_id
where lic.buyer_org_id = auth_org_id() or lic.creator_org_id = auth_org_id();

-- §15 Storage buckets + policies ──────────────────────────────────────────
insert into storage.buckets (id, name, public) values
  ('consent-videos', 'consent-videos', false),
  ('deliverables',   'deliverables',   false),
  ('previews',       'previews',       true)
on conflict (id) do nothing;

-- Path convention: {bucket}/{org_id}/{entity_id}/{filename}
create policy "consent_videos_insert_own_org" on storage.objects for insert to authenticated
  with check (bucket_id = 'consent-videos'
              and (storage.foldername(name))[1] = auth_org_id()::text
              and auth_role() = 'creator');
create policy "consent_videos_select_own_org" on storage.objects for select to authenticated
  using (bucket_id = 'consent-videos'
         and ((storage.foldername(name))[1] = auth_org_id()::text or auth_role() = 'admin'));
create policy "previews_insert_own_org" on storage.objects for insert to authenticated
  with check (bucket_id = 'previews'
              and (storage.foldername(name))[1] = auth_org_id()::text);
create policy "previews_public_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'previews');
-- deliverables: NO client policies. Signed URLs minted by the sanctioned
-- api/assets/* route after an RLS-checked party read (ARCHITECTURE §2).

-- §16 Function grant matrix (load-bearing — DATA_MODEL §5) ────────────────
revoke execute on all functions in schema public from public, anon, authenticated;

-- RLS helper predicates: evaluated as the querying role
grant execute on function auth_org_id() to anon, authenticated;
grant execute on function auth_role()   to anon, authenticated;

-- Public verify path
grant execute on function verify_generation(uuid) to anon, authenticated;

-- User-callable RPCs (each re-checks the caller inside the function)
grant execute on function submit_consent(text, text, jsonb, text) to authenticated;
grant execute on function revoke_consent(uuid, text)              to authenticated;
grant execute on function decide_request(uuid, text, text, text)  to authenticated;
grant execute on function begin_checkout(uuid)                    to authenticated;
grant execute on function create_generation(uuid)                 to authenticated;

-- service_role-only RPCs (granting these to authenticated = total gate bypass)
grant execute on function mark_consent_verified(uuid)                to service_role;
grant execute on function mark_avatar_ready(uuid, text)              to service_role;
grant execute on function mark_avatar_failed(uuid, text)             to service_role;
grant execute on function apply_policy_verdict(uuid, jsonb)          to service_role;
grant execute on function activate_license(uuid, text)               to service_role;
grant execute on function complete_generation(uuid, text, jsonb)     to service_role;

-- View grants: the four public views are the ONLY anon read surface (plus
-- policy_clauses and the previews bucket). license_details is parties-only.
grant select on public_listings, public_creators, public_listing_tiers, public_listing_rules
  to anon, authenticated;
grant select on license_details to authenticated;
revoke all on license_details from anon;

-- §17 Clause seeds ────────────────────────────────────────────────────────
insert into policy_clauses (code, title, description, keywords, is_platform, default_on, sort_order) values
('PC-01','Political content','This replica may not be used for political content, parties, candidates, or campaigns.',
 array['election','vote','party','candidate','minister','campaign','politician','ballot'], false, true, 1),
('PC-02','Alcohol, tobacco & gambling','This replica may not promote alcohol, tobacco, vaping, or gambling products.',
 array['alcohol','beer','whisky','whiskey','vodka','rum','wine','cigarette','tobacco','vape','vaping','casino','betting','bet','gamble','gambling','lottery','rummy','poker'], false, true, 2),
('PC-03','Medical & health claims','This replica may not make medical, health, or weight-loss claims.',
 array['cure','cures','cured','heal','heals','doctor','doctors','medical','disease','diagnosis','blood sugar','blood pressure','diabetes','cancer','weight loss','fat burn','immunity','antibiotic','prescription'], false, true, 3),
('PC-04','Financial advice & crypto','This replica may not give financial advice or promote crypto, trading, or get-rich schemes.',
 array['crypto','bitcoin','trading','forex','stocks','investment','returns','guaranteed profit','get rich','portfolio','mutual fund','ipo'], false, true, 4),
('PC-05','Adult or suggestive content','This replica may not appear in adult, sexual, or suggestive content.',
 array['adult','nude','sexual','explicit','onlyfans','lingerie'], false, true, 5),
('PC-06','Religious content','This replica may not be used for religious content or messaging.',
 array['religion','religious','temple','church','mosque','god','worship','prayer'], false, true, 6),
('PC-07','Competitor brands','This replica may not promote brands the creator has excluded (see listing notes).',
 array[]::text[], false, false, 7),
('PC-08','False personal claims','Scripts may not claim personal use, results, or endorsement history that is not real.',
 array['i use daily','i have been using','changed my life','my results'], false, true, 8),
('PC-09','Children-targeted advertising','This replica may not be used in advertising aimed at children.',
 array['kids','children','toddler','baby','school-going'], false, true, 9),
('PC-10','Weapons','This replica may not promote weapons or related products.',
 array['gun','guns','rifle','pistol','knife','ammo','ammunition','weapon'], false, true, 10),
('PP-01','Political content (platform)','This platform does not generate political content of any kind: parties, candidates, campaigning, lobbying, or election influence.',
 array['election','vote','party','candidate','minister','campaign','politician','lobbying','ballot'], true, true, 101),
('PP-02','Public-health & civic misinformation','Scripts may not make false or misleading claims about health, elections, civic processes, or current events.',
 array['miracle cure','no side effects','doctors hate','guaranteed cure','vaccine'], true, true, 102),
('PP-03','Sexual/adult content','Sexually explicit or suggestive adult content is not permitted.',
 array['nude','sexual','explicit','porn'], true, true, 103),
('PP-04','Fraud & deception','Scripts that facilitate scams, phishing, impersonation, or deceptive practices are not permitted.',
 array['phishing','scam','otp','password','impersonate','lottery winner','prize money'], true, true, 104),
('PP-05','Content involving minors','Content targeting or depicting minors is not permitted.',
 array[]::text[], true, true, 105),
('PP-06','Category mismatch','The declared campaign category must be one the creator has allowed for this listing.',
 array[]::text[], true, true, 106);

-- §18 Indexes ─────────────────────────────────────────────────────────────
create index on approval_requests (buyer_org_id, created_at desc);
create index on approval_requests (creator_org_id, status) where status = 'needs_review';
create index on licenses (buyer_org_id, status);
create index on licenses (creator_org_id, status);
create index on generations (license_id);
create index on generations (status) where status in ('queued','generating','processing');
create index on audit_log (actor_org_id, created_at desc);
create index on audit_log ((meta->>'creator_org_id'), created_at desc);
create index on listings (status) where status = 'published';
create index on avatars (org_id);
create index on consent_records (org_id, status);

-- §19 Realtime (live audit feed on the creator dashboard) ─────────────────
alter publication supabase_realtime add table audit_log;






