-- (applied live 2026-07-28) The public registry rendered "Takedowns filed: 0"
-- as a hardcoded literal on every star's page, while the creator dashboard and
-- the admin desk showed real reports — the platform contradicting itself about
-- its own enforcement on the single page the whole pitch rests on.
--
-- Public-safe AGGREGATE only: counts, never the report text, the reporter, or
-- the accused URL. Same shape as public_follow_counts.
create or replace view public_takedown_counts as
select l.creator_id,
       count(*) filter (where r.status = 'actioned')            as actioned,
       count(*) filter (where r.status in ('open','reviewing')) as open_now
from reports r
join listings l on l.org_id = r.creator_org_id
group by l.creator_id;
grant select on public_takedown_counts to anon, authenticated;
