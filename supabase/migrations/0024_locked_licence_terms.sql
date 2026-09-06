-- Licence terms LOCKED at purchase.
--
-- From the competitor-review research (2026-08-01): the single most corrosive
-- recurring complaint against incumbents is terms drifting under a paid deal —
-- HeyGen's "unlimited" plans silently became ~4-videos-of-credits at the same
-- price (Trustpilot 2.4/5, dominant cluster), Cameo repriced after its own
-- fulfilment failures, Billo expired prepaid balances. Our schema had the same
-- latent hole: licenses referenced license_tiers LIVE — create_generation read
-- max_generations and activate_license read duration_days at use-time, while
-- creators can edit tiers freely. Editing a tier could shrink a paid licence.
--
-- Fix: snapshot every term into the licence row at checkout, and make every
-- later decision read ONLY the snapshot. The tier row becomes what it should
-- have been: a price list for FUTURE orders. (amount_paise was already
-- snapshotted; this completes the set.)
alter table licenses add column if not exists tier_name       text;
alter table licenses add column if not exists max_generations int;
alter table licenses add column if not exists duration_days   int;
alter table licenses add column if not exists exclusivity     text;

update licenses l set
  tier_name       = coalesce(l.tier_name, t.name),
  max_generations = coalesce(l.max_generations, t.max_generations),
  duration_days   = coalesce(l.duration_days, t.duration_days),
  exclusivity     = coalesce(l.exclusivity, t.exclusivity::text)
from license_tiers t where t.id = l.tier_id;

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
                        status, amount_paise, tier_name, max_generations, duration_days, exclusivity)
  values (p_request_id, v.buyer_org_id, v.creator_org_id, v.listing_id, v.tier_id,
          'payment_pending', v_tier.price_paise, v_tier.name, v_tier.max_generations,
          v_tier.duration_days, v_tier.exclusivity::text)
  returning id into v_id;
  perform append_audit(auth.uid(), 'license.payment_pending', 'licenses', v_id,
    jsonb_build_object('buyer_org_id', v.buyer_org_id, 'creator_org_id', v.creator_org_id,
                       'amount_paise', v_tier.price_paise));
  return v_id;
end $$;

-- Expiry now derives from the SNAPSHOTTED duration, and the platform fee reads
-- the published take_rate_bps setting instead of a hardcoded 15% — the payout
-- must always match the rate we publicly advertise.
create or replace function activate_license(p_license_id uuid, p_rzp_payment_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v licenses%rowtype; v_days int; v_rate int; v_fee bigint;
begin
  select * into v from licenses where id = p_license_id for update;
  if not found then raise exception 'LICENSE:not_found'; end if;
  if v.status = 'active' then return; end if;  -- idempotent: payment.captured AND order.paid both fire
  if v.status <> 'payment_pending' then raise exception 'LICENSE:not_payment_pending'; end if;
  v_days := coalesce(v.duration_days,
    (select duration_days from license_tiers where id = v.tier_id));
  update licenses
     set status = 'active',
         razorpay_payment_id = p_rzp_payment_id,
         starts_at = now(),
         expires_at = now() + make_interval(days => v_days)
   where id = p_license_id;
  v_rate := coalesce((select (value #>> '{}')::int from platform_settings where key = 'take_rate_bps'), 1500);
  v_fee := round(v.amount_paise * v_rate / 10000.0);
  insert into payouts (org_id, license_id, gross_paise, platform_fee_paise, net_paise)
  values (v.creator_org_id, v.id, v.amount_paise, v_fee, v.amount_paise - v_fee);
  perform append_audit(null, 'license.activated', 'licenses', p_license_id,
    jsonb_build_object('buyer_org_id', v.buyer_org_id, 'creator_org_id', v.creator_org_id,
                       'razorpay_payment_id', p_rzp_payment_id, 'take_rate_bps', v_rate));
end $$;

-- The generation gate's quota now reads the licence snapshot (engine-choice
-- version of the function, from 0023, otherwise unchanged).
create or replace function create_generation(p_license_id uuid, p_engine text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_lic     licenses%rowtype;
  v_req     approval_requests%rowtype;
  v_consent consent_records%rowtype;
  v_avatar  avatars%rowtype;
  v_max     int;
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
  if p_engine is not null then
    if p_engine not in ('tavus','heygen','did') then raise exception 'GATE:engine_unavailable'; end if;
    if not exists (
      select 1 from avatars a
      join consent_records c on c.id = a.consent_record_id
      where a.org_id = v_lic.creator_org_id and a.provider = p_engine
        and a.status = 'ready' and c.status = 'verified'
    ) then raise exception 'GATE:engine_unavailable'; end if;
  end if;
  v_max := coalesce(v_lic.max_generations,
    (select max_generations from license_tiers where id = v_lic.tier_id));
  select count(*) into v_count from generations
   where license_id = v_lic.id
     and status not in ('failed','changes_requested','rejected');
  if v_count >= v_max then raise exception 'GATE:quota_exhausted'; end if;
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

-- Published platform economics, readable by anyone: the take rate we advertise
-- is the take rate the payout math uses (activate_license reads the same key).
create or replace function public_take_rate_bps()
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from platform_settings where key = 'take_rate_bps'), 1500);
$$;
grant execute on function public_take_rate_bps() to anon, authenticated;
