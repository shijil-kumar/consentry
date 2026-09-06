-- 0002 — Phase 1 additions:
--   · consent_records.voice_captcha (ElevenLabs consent voice-captcha evidence, UPDATES 2026-07-09)
--   · submit_consent v2 (accepts the captcha evidence at insert — the row is born complete)
--   · append_audit pinned to timezone UTC (deterministic created_at::text for hash verification)
--   · verify_audit_chain() — B1.4 chain verifier, runs entirely in Postgres so the
--     hash recomputation uses the exact same operators/serialization as the writer

alter table consent_records add column voice_captcha jsonb;

-- submit_consent v2 (old signature dropped; grants re-issued)
drop function if exists submit_consent(text, text, jsonb, text);

create or replace function submit_consent(p_video_path text, p_hash text,
                                          p_scope jsonb, p_script_version text,
                                          p_voice_captcha jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_profile profiles%rowtype; v_id uuid;
begin
  select * into v_profile from profiles where id = auth.uid();
  if not found or v_profile.role <> 'creator' then raise exception 'CONSENT:not_a_creator'; end if;
  insert into consent_records (org_id, creator_id, consent_video_path, content_hash,
                               consent_script_version, scope, voice_captcha)
  values (v_profile.org_id, v_profile.id, p_video_path, p_hash, p_script_version, p_scope, p_voice_captcha)
  returning id into v_id;
  perform append_audit(auth.uid(), 'consent.granted', 'consent_records', v_id,
                       jsonb_build_object('creator_org_id', v_profile.org_id,
                                          'content_hash', p_hash,
                                          'voice_captcha_verified', coalesce(p_voice_captcha->>'verified', 'null')));
  return v_id;
end $$;

revoke all on function submit_consent(text, text, jsonb, text, jsonb) from public, anon;
grant execute on function submit_consent(text, text, jsonb, text, jsonb) to authenticated;

-- append_audit: identical body, now with SET timezone = 'UTC' so created_at::text
-- is deterministic no matter which session/connection performs the insert.
create or replace function append_audit(p_actor uuid, p_action text, p_target_table text,
                                        p_target_id uuid, p_meta jsonb default '{}')
returns bigint language plpgsql security definer
set search_path = public, extensions set timezone = 'UTC' as $$
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

-- B1.4 — chain verifier. Recomputes every row hash and checks chain continuity.
create or replace function verify_audit_chain()
returns table (total bigint, bad bigint, first_bad_id bigint)
language sql stable security definer
set search_path = public, extensions set timezone = 'UTC' as $$
  with x as (
    select id, prev_hash, row_hash,
      encode(digest(
        prev_hash || action || coalesce(target_table, '') || coalesce(target_id::text, '')
                  || meta::text || created_at::text, 'sha256'), 'hex') as recomputed,
      lag(row_hash) over (order by id) as expected_prev
    from audit_log
  )
  select count(*),
         count(*) filter (where recomputed <> row_hash
                             or coalesce(expected_prev, repeat('0', 64)) <> prev_hash),
         min(id)  filter (where recomputed <> row_hash
                             or coalesce(expected_prev, repeat('0', 64)) <> prev_hash)
  from x
$$;

revoke all on function verify_audit_chain() from public, anon, authenticated;
grant execute on function verify_audit_chain() to service_role;
