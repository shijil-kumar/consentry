-- complete_generation() hardcoded `watermarked = true`, so the column asserted a
-- visible AI label even when the burn-in had failed. Caught on production, where
-- ffmpeg's drawtext could not initialise (no font on the Linux runtime): the row
-- read watermarked=true while the stored manifest correctly read _watermarked
-- false. A compliance flag that cannot say "no" is worse than no flag — the
-- public /verify surface and the IT-Rules labelling claim both read from here.
--
-- Now derived from what the pipeline actually did. The worker already puts the
-- real outcome in the manifest as `watermarked`; default false so a manifest
-- missing the key can never silently claim success.
create or replace function complete_generation(p_generation_id uuid, p_output_path text, p_manifest jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v generations%rowtype;
begin
  select * into v from generations where id = p_generation_id for update;
  if not found then raise exception 'GENERATION:not_found'; end if;
  if v.status = 'delivered' then return; end if;  -- idempotent
  if v.status <> 'processing' then raise exception 'GENERATION:not_processing'; end if;
  update generations
     set status = 'delivered', output_path = p_output_path, c2pa_manifest = p_manifest,
         watermarked = coalesce((p_manifest->>'watermarked')::boolean, false),
         delivered_at = now()
   where id = p_generation_id;
  perform append_audit(null, 'generation.delivered', 'generations', p_generation_id,
    jsonb_build_object('buyer_org_id', v.buyer_org_id, 'creator_org_id', v.creator_org_id));
end $$;
