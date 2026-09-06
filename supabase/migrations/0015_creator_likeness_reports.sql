-- (applied live 2026-07-27) BUGFIX: a celebrity could not see reports filed
-- about their OWN likeness. reports_select only allowed
--   (reporter_id = auth.uid()) OR (auth_role() = 'admin')
-- so /creator/protection's "Recent alerts" panel — the hero panel of the
-- protection-first product — was permanently empty for every creator.
--
-- Fix: a SECURITY DEFINER view scoped to the targeted creator's org, which
-- deliberately OMITS reporter_id / reporter_email so a celebrity can see that
-- they were reported and act on it, but can never unmask the reporter.
-- The base `reports` table policy is unchanged.
create or replace view my_likeness_reports
with (security_invoker = off) as
select r.id, r.category, r.status, r.detail, r.sla_deadline,
       r.resolved_at, r.resolution_note, r.generation_id, r.created_at,
       r.creator_org_id
from reports r
where r.creator_org_id = auth_org_id();

revoke all on my_likeness_reports from anon;
grant select on my_likeness_reports to authenticated;
