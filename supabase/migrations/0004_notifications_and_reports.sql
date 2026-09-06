-- 0004 — competitive features: in-app notifications + takedown/report flow.

-- ── Notifications ──────────────────────────────────────────────────────────
create type notification_type as enum (
  'request_received', 'request_decided', 'video_delivered',
  'license_earned', 'consent_revoked', 'report_filed'
);

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id),   -- recipient org
  type         notification_type not null,
  title        text not null,
  body         text,
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index on notifications (org_id, created_at desc);
create index on notifications (org_id) where read_at is null;

alter table notifications enable row level security;
create policy notif_select_own on notifications for select to authenticated
  using (org_id = auth_org_id());
-- recipients may mark their own read; nothing else client-writable
create policy notif_mark_read on notifications for update to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
revoke insert, delete on notifications from anon, authenticated;
grant update (read_at) on notifications to authenticated;
alter publication supabase_realtime add table notifications;

create or replace function notify(p_org uuid, p_type notification_type,
                                  p_title text, p_body text default null, p_link text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_org is null then return; end if;
  insert into notifications (org_id, type, title, body, link)
  values (p_org, p_type, p_title, p_body, p_link);
end $$;

-- ── Reports / takedown requests (IT Rules 2026 fast-takedown surface) ───────
create type report_category as enum (
  'impersonation', 'non_consensual', 'ip_infringement', 'unlawful_content', 'other'
);
create type report_status as enum ('open', 'reviewing', 'actioned', 'dismissed');

create table reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid references profiles(id),   -- null = anonymous public report
  reporter_email    text,
  generation_id     uuid references generations(id),
  creator_org_id    uuid references orgs(id),
  category          report_category not null,
  detail            text not null,
  status            report_status not null default 'open',
  -- IT Rules 2026: impersonation/intimate = 2h, court/gov = 3h; we use a 3h
  -- default SLA and 2h for impersonation, surfaced as a countdown in admin.
  sla_deadline      timestamptz not null,
  resolved_at       timestamptz,
  resolution_note   text,
  created_at        timestamptz not null default now()
);
create index on reports (status, sla_deadline);
create index on reports (creator_org_id);

alter table reports enable row level security;
-- reporter sees their own; the reported creator sees reports about them; admin sees all
create policy reports_select on reports for select to authenticated
  using (reporter_id = auth.uid() or creator_org_id = auth_org_id() or auth_role() = 'admin');
revoke insert, update, delete on reports from anon, authenticated;

-- File a report (authenticated or anon via the public route which passes null).
create or replace function file_report(p_generation_id uuid, p_category report_category,
                                       p_detail text, p_reporter_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_creator_org uuid; v_sla interval; v_id uuid;
begin
  select creator_org_id into v_creator_org from generations where id = p_generation_id;
  v_sla := case when p_category in ('impersonation','non_consensual')
                then interval '2 hours' else interval '3 hours' end;
  insert into reports (reporter_id, reporter_email, generation_id, creator_org_id,
                       category, detail, sla_deadline)
  values (auth.uid(), p_reporter_email, p_generation_id, v_creator_org,
          p_category, p_detail, now() + v_sla)
  returning id into v_id;
  perform append_audit(auth.uid(), 'report.filed', 'reports', v_id,
    jsonb_build_object('creator_org_id', v_creator_org, 'category', p_category));
  if v_creator_org is not null then
    perform notify(v_creator_org, 'report_filed', 'A video was reported',
      'A delivered video was reported for review.', '/creator');
  end if;
  return v_id;
end $$;

create or replace function resolve_report(p_report_id uuid, p_status report_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update reports set status = p_status, resolved_at = now(), resolution_note = p_note
   where id = p_report_id;
  perform append_audit(auth.uid(), 'report.resolved', 'reports', p_report_id,
    jsonb_build_object('status', p_status));
end $$;

revoke all on function notify(uuid, notification_type, text, text, text) from public, anon, authenticated;
revoke all on function file_report(uuid, report_category, text, text) from public, anon, authenticated;
revoke all on function resolve_report(uuid, report_status, text) from public, anon, authenticated;
grant execute on function file_report(uuid, report_category, text, text) to anon, authenticated;
grant execute on function resolve_report(uuid, report_status, text) to service_role;
