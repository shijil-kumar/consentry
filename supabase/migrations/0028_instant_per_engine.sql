-- Per-engine instant preview.
--
-- WHY: the brand's picker offered ONE "Instant demo", served by the free mock
-- engine. Its sample happens to be a 16:9 talking head, so on stage it read as
-- "Tavus output" no matter which engine you were talking about — there was no
-- way to show a viewer what HEYGEN produces without paying for a live render
-- and waiting minutes.
--
-- Instant is now a property of the REQUEST, not of the platform: pick an engine
-- and pick whether you want it rendered fresh or replayed instantly. Replay
-- returns that engine's own most recent real output, so "this is Tavus" and
-- "this is HeyGen" are both true statements you can make in seconds.
--
-- NOT a bypass: p_engine validation below still demands a READY avatar on that
-- engine backed by a VERIFIED consent record. Instant changes who draws the
-- pixels, never whether consent exists.

alter table generations add column if not exists requested_mode text
  check (requested_mode in ('live', 'instant'));

comment on column generations.requested_mode is
  'What the brand asked for at request time. instant = replay that engine''s own '
  'earlier render (free, seconds). live = call the paid API. null = platform default.';

-- Drop the two-argument version FIRST. Adding a three-argument overload beside
-- it makes any call naming only (p_license_id, p_engine) ambiguous, and
-- PostgREST refuses it with "Could not choose the best candidate function" —
-- which breaks every existing caller. The new signature has defaults and so
-- serves every shape the old one did.
drop function if exists create_generation(uuid, text);

create or replace function create_generation(
  p_license_id uuid,
  p_engine text default null,
  p_mode text default null
)
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

  if p_mode is not null and p_mode not in ('live','instant') then
    raise exception 'GATE:bad_mode';
  end if;
  -- Instant is only meaningful for an engine we hold a real earlier render of.
  if p_mode = 'instant' and (p_engine is null or p_engine not in ('tavus','heygen')) then
    raise exception 'GATE:instant_needs_engine';
  end if;

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
                           provider, script, script_hash, status, requested_engine, requested_mode)
  values (v_lic.id, v_req.id, v_lic.buyer_org_id, v_lic.creator_org_id,
          v_avatar.provider, v_req.script, v_req.script_hash, 'queued', p_engine, p_mode)
  returning id into v_id;
  perform append_audit(auth.uid(), 'generation.queued', 'generations', v_id,
                       jsonb_build_object('license_id', v_lic.id,
                                          'buyer_org_id', v_lic.buyer_org_id,
                                          'creator_org_id', v_lic.creator_org_id,
                                          'requested_engine', p_engine,
                                          'requested_mode', p_mode));
  return v_id;
end $$;

revoke all on function create_generation(uuid, text, text) from public, anon;
grant execute on function create_generation(uuid, text, text) to authenticated;
