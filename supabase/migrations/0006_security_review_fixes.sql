-- 0006 — security review fixes for the new features (2026-07-11).

-- FIX (major): reports RLS leaked reporter_email + reporter_id to the ACCUSED
-- creator (any member of the reported org could read complainant PII — a
-- retaliation/safety risk, esp. for impersonation/NCII victims). Creators are
-- informed via a PII-free notification instead; only the reporter and admins
-- may read the raw report row.
drop policy if exists reports_select on reports;
create policy reports_select on reports for select to authenticated
  using (reporter_id = auth.uid() or auth_role() = 'admin');

-- FIX (minor): notifications UPDATE was never revoked, so authenticated could
-- rewrite any column of their own-org notifications (title/body/link/type),
-- not just read_at. Revoke table UPDATE, then re-grant only the read_at column
-- (the profiles pattern).
revoke update on notifications from anon, authenticated;
grant update (read_at) on notifications to authenticated;

-- FIX (minor): file_report is anon-callable with no throttle → notification-
-- flood + takedown-queue poisoning. Add a DB-side throttle: cap open reports
-- per generation, and cap anonymous reports globally per short window.
create or replace function file_report(p_generation_id uuid, p_category report_category,
                                       p_detail text, p_reporter_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_creator_org uuid; v_sla interval; v_id uuid; v_open int; v_recent int;
begin
  if char_length(coalesce(p_detail,'')) < 10 then raise exception 'REPORT:detail_too_short'; end if;
  -- per-generation open-report cap
  if p_generation_id is not null then
    select count(*) into v_open from reports
     where generation_id = p_generation_id and status in ('open','reviewing');
    if v_open >= 10 then raise exception 'REPORT:too_many_open'; end if;
  end if;
  -- anonymous burst cap (reporter_id null) across the last 5 minutes
  if auth.uid() is null then
    select count(*) into v_recent from reports
     where reporter_id is null and created_at > now() - interval '5 minutes';
    if v_recent >= 20 then raise exception 'REPORT:rate_limited'; end if;
  end if;

  select creator_org_id into v_creator_org from generations where id = p_generation_id;
  v_sla := case when p_category in ('impersonation','non_consensual')
                then interval '2 hours' else interval '3 hours' end;
  insert into reports (reporter_id, reporter_email, generation_id, creator_org_id,
                       category, detail, sla_deadline)
  values (auth.uid(), nullif(trim(lower(p_reporter_email)), ''), p_generation_id, v_creator_org,
          p_category, left(p_detail, 600), now() + v_sla)
  returning id into v_id;
  perform append_audit(auth.uid(), 'report.filed', 'reports', v_id,
    jsonb_build_object('creator_org_id', v_creator_org, 'category', p_category));
  if v_creator_org is not null then
    perform notify(v_creator_org, 'report_filed', 'A video was reported',
      'A delivered video was reported for review.', '/creator');
  end if;
  return v_id;
end $$;

revoke all on function file_report(uuid, report_category, text, text) from public, anon, authenticated;
grant execute on function file_report(uuid, report_category, text, text) to anon, authenticated;
