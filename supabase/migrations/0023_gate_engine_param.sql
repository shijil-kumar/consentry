-- Engine choice runs THROUGH the gate, not around it.
--
-- The first cut validated the engine in the API route with the service-role
-- client — which is exactly what the no-service-role-outside-jobs lint exists
-- to prevent, and it split "may I generate" from "on which engine" across two
-- privilege levels. Moving the check into create_generation() keeps a single
-- SECURITY DEFINER authority: validation + stamping happen in the same
-- transaction as the six existing gates, and an unavailable engine raises
-- GATE:engine_unavailable before the quota slot is consumed.
--
-- Also adds available_engines(): the tiny, deliberately-public read the buyer
-- UI needs to draw the picker (provider names only — never replica ids).
--
-- Base body reproduced from the LIVE definition (includes the 0019 quota fix:
-- changes_requested/rejected don't count). p_engine default null keeps every
-- existing caller working unchanged.
create or replace function create_generation(p_license_id uuid, p_engine text default null)
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
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.org_id = v_lic.buyer_org_id)
    then raise exception 'GATE:not_buyer'; end if;
  if v_lic.status <> 'active' or now() > v_lic.expires_at
    then raise exception 'GATE:license_not_active'; end if;
  select * into v_req from approval_requests where id = v_lic.request_id;
  if v_req.status not in ('auto_approved','approved') then raise exception 'GATE:not_approved'; end if;
  if encode(digest(v_req.script, 'sha256'), 'hex') <> v_req.script_hash
    then raise exception 'GATE:script_tampered'; end if;
  select c.* into v_consent
  from consent_records c
  join avatars a on a.consent_record_id = c.id
  join listings l on l.avatar_id = a.id
  where l.id = v_lic.listing_id;
  if not found or v_consent.status <> 'verified' then raise exception 'GATE:consent_revoked'; end if;
  select a.* into v_avatar from avatars a join listings l on l.avatar_id = a.id where l.id = v_lic.listing_id;
  if v_avatar.status <> 'ready' then raise exception 'GATE:avatar_unavailable'; end if;
  -- 6b. explicit engine pick: the creator must have a READY avatar on that
  -- engine backed by a VERIFIED consent record. Checked here so a bad pick
  -- fails before the quota count below ever runs.
  if p_engine is not null then
    if p_engine not in ('tavus','heygen','did') then raise exception 'GATE:engine_unavailable'; end if;
    if not exists (
      select 1 from avatars a
      join consent_records c on c.id = a.consent_record_id
      where a.org_id = v_lic.creator_org_id and a.provider = p_engine
        and a.status = 'ready' and c.status = 'verified'
    ) then raise exception 'GATE:engine_unavailable'; end if;
  end if;
  select * into v_tier from license_tiers where id = v_lic.tier_id;
  select count(*) into v_count from generations
   where license_id = v_lic.id
     and status not in ('failed','changes_requested','rejected');
  if v_count >= v_tier.max_generations then raise exception 'GATE:quota_exhausted'; end if;
  insert into generations (license_id, request_id, buyer_org_id, creator_org_id,
                           provider, script, script_hash, status, requested_engine)
  values (v_lic.id, v_req.id, v_lic.buyer_org_id, v_lic.creator_org_id,
          v_avatar.provider, v_req.script, v_req.script_hash, 'queued', p_engine)
  returning id into v_id;
  perform append_audit(auth.uid(), 'generation.queued', 'generations', v_id,
                       jsonb_build_object('license_id', v_lic.id,
                                          'buyer_org_id', v_lic.buyer_org_id,
                                          'creator_org_id', v_lic.creator_org_id,
                                          'requested_engine', p_engine));
  return v_id;
end $$;

-- Engine list for the buyer's picker: provider names of ready, consent-verified
-- avatars. SECURITY DEFINER because avatars are creator-private under RLS, but
-- WHICH ENGINES exist is marketing (the marketplace advertises the formats).
create or replace function available_engines(p_creator_org_id uuid)
returns text[] language sql security definer set search_path = public as $$
  select coalesce(array_agg(distinct a.provider), '{}')
  from avatars a
  join consent_records c on c.id = a.consent_record_id
  where a.org_id = p_creator_org_id and a.status = 'ready'
    and c.status = 'verified' and a.provider in ('tavus','heygen','did');
$$;
grant execute on function available_engines(uuid) to authenticated;

-- CREATE OR REPLACE with a new parameter list makes an OVERLOAD, not a
-- replacement: both signatures matched a call naming only p_license_id and
-- PostgREST refused the ambiguity — every generation call failed until the
-- old signature was dropped. Keep exactly one.
drop function if exists create_generation(uuid);
