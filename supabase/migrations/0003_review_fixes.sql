-- 0003 — code-review fixes (2026-07-10).

-- FIX #1 (major): raw_output_url leak. The generations SELECT RLS policy is a
-- whole-row policy, so a license party (the buyer) could read raw_output_url —
-- the UNWATERMARKED, UN-C2PA-signed provider URL — via the anon-key client and
-- download the clean video, defeating the entire watermark/provenance guarantee
-- (POLICY_AND_CONSENT_SPEC §5.2: "never exposed to any client").
-- Column-level privileges: authenticated may SELECT every column EXCEPT
-- raw_output_url. RLS still governs which ROWS. service_role keeps full access
-- (the media worker reads raw_output_url server-side).
revoke select on generations from authenticated;
grant select (
  id, license_id, request_id, buyer_org_id, creator_org_id, provider,
  provider_video_id, script, script_hash, status, output_path, c2pa_manifest,
  watermarked, error, delivered_at, created_at
) on generations to authenticated;
grant select on generations to service_role;

-- FIX #3 (major): the expiry sweep must NOT expire an approval_request once it
-- has been paid (a license exists). create_generation() re-checks that the
-- request is still auto_approved/approved, so expiring a licensed request would
-- brick any license longer than 7 days (e.g. the 30-day campaign tier).
-- Enforce it at the DB layer with a guard function the worker's sweep uses.
create or replace function sweep_expire_requests()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update approval_requests r
     set status = 'expired'
   where r.status in ('pending_check','auto_approved','approved','needs_review')
     and r.expires_at < now()
     and not exists (select 1 from licenses l where l.request_id = r.id);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function sweep_expire_pending_licenses()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update licenses
     set status = 'expired'
   where status = 'payment_pending'
     and created_at < now() - interval '24 hours';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function sweep_expire_requests() from public, anon, authenticated;
revoke all on function sweep_expire_pending_licenses() from public, anon, authenticated;
grant execute on function sweep_expire_requests() to service_role;
grant execute on function sweep_expire_pending_licenses() to service_role;
