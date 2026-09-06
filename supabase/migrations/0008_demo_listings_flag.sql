-- Demo listings: flag + surfaced through the public view so the grid can badge them.
alter table listings add column if not exists is_demo boolean not null default false;

drop view if exists public_listings;
create view public_listings with (security_invoker = off) as
select l.id, l.title, l.bio, l.allowed_categories, l.is_demo,
       p.display_name, p.handle, p.avatar_url,
       a.preview_video_url,
       c.status = 'verified'::consent_status as consent_verified,
       c.verified_at as consent_verified_at
from listings l
join profiles p on p.id = l.creator_id
join avatars a on a.id = l.avatar_id
join consent_records c on c.id = a.consent_record_id
where l.status = 'published'::listing_status;

grant select on public_listings to anon, authenticated;
