-- Exact-bytes fingerprint of the delivered file.
--
-- Why: the "scan a video" tool identified files by reading the embedded C2PA
-- manifest, which needs the c2patool binary. Every published c2patool Linux
-- build links GLIBC_2.39; Vercel's runtime (Amazon Linux 2023) provides 2.34,
-- so on the hosted demo the scanner could not read ANY file — including one we
-- had just signed ourselves. Hashing needs no binary and works everywhere.
--
-- This is identification, not signature verification: it proves "these exact
-- bytes came from this licence", and says nothing about a re-encoded copy.
-- Callers MUST report the two verdicts distinctly (see app/api/inspect).
alter table generations add column if not exists output_sha256 text;
create index if not exists generations_output_sha256_idx
  on generations (output_sha256) where output_sha256 is not null;

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
         output_sha256 = p_manifest->>'_sha256',
         delivered_at = now()
   where id = p_generation_id;
  perform append_audit(null, 'generation.delivered', 'generations', p_generation_id,
    jsonb_build_object('buyer_org_id', v.buyer_org_id, 'creator_org_id', v.creator_org_id));
end $$;
