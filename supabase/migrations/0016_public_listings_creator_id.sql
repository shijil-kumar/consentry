-- (applied live 2026-07-27) public_listings did not expose creator_id, so the
-- Follow button could only resolve a celebrity id from public_registry — i.e.
-- from DELIVERED content. Five of six stars had no delivered video, so the core
-- fan action simply did not render on their registry pages, and their follower
-- counts were permanently 0.
--
-- creator_id is already public via public_registry.creator_id and
-- public_follow_counts.celebrity_id, so this exposes nothing new.
drop view if exists public_listings cascade;
create view public_listings as
 SELECT l.id, l.title, l.bio, l.allowed_categories, l.is_demo, l.creator_id,
    p.display_name, p.handle, p.avatar_url,
    (p.kyc_status = 'verified'::text) AS kyc_verified,
    a.preview_video_url,
    (c.status = 'verified'::consent_status) AS consent_verified,
    c.verified_at AS consent_verified_at
   FROM listings l
     JOIN profiles p ON p.id = l.creator_id
     JOIN avatars a ON a.id = l.avatar_id
     JOIN consent_records c ON c.id = a.consent_record_id
  WHERE l.status = 'published'::listing_status;
grant select on public_listings to anon, authenticated;

-- Demo creators also got real, gender/niche-matched portraits; previously every
-- page except arjun's fell back to the same literal /actors/a1.jpg (a woman),
-- including both male creators.
-- update profiles set avatar_url = '/actors/aN.jpg' where handle = '...';
