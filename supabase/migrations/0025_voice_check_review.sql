-- Voice-check review queue.
--
-- The consent recorder ran an ElevenLabs Scribe check on the spoken challenge
-- phrase and, when it could not confirm the phrase, told the creator "voice
-- check pending — awaiting human review". No human surface existed: the result
-- was written to consent_records.voice_captcha and shown only on the creator's
-- own dashboard. Nobody was reviewing it. This adds the reviewer.
--
-- Scope note: this is NOT the platform overruling a creator about their own
-- likeness (that stays the creator's call, by design). A voice check is an
-- identity/anti-fraud question — "is this really them?" — which is exactly the
-- platform's job, so an admin decision here is legitimate.

alter table consent_records
  add column if not exists voice_review_state text
    check (voice_review_state in ('pending', 'accepted', 'rejected')),
  add column if not exists voice_reviewed_by uuid references profiles(id),
  add column if not exists voice_reviewed_at timestamptz,
  add column if not exists voice_review_note text;

-- Backfill: anything whose automated check did not verify is awaiting a human.
update consent_records
   set voice_review_state = 'pending'
 where voice_review_state is null
   and coalesce((voice_captcha ->> 'verified')::boolean, false) = false;

-- Partial index — the queue only ever reads the pending slice.
create index if not exists consent_records_voice_pending_idx
  on consent_records (created_at desc)
  where voice_review_state = 'pending';

-- Admin-only decision, recorded in the hash-chained ledger. SECURITY DEFINER so
-- the write cannot be reproduced by a client crafting its own UPDATE: the only
-- path to these columns is this function, and it hard-checks the admin role.
create or replace function review_voice_check(
  p_consent_id uuid,
  p_decision   text,
  p_note       text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role  user_role;
  v_org   uuid;
begin
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'decision must be accepted or rejected';
  end if;

  select role into v_role from profiles where id = v_actor;
  if v_role is distinct from 'admin' then
    raise exception 'admins only';
  end if;

  select org_id into v_org from consent_records where id = p_consent_id;
  if v_org is null then
    raise exception 'no such consent record';
  end if;

  update consent_records
     set voice_review_state = p_decision,
         voice_reviewed_by  = v_actor,
         voice_reviewed_at  = now(),
         voice_review_note  = nullif(trim(coalesce(p_note, '')), '')
   where id = p_consent_id;

  -- A rejected voice check means we could not confirm the speaker is who they
  -- claim, so the consent itself stops being a basis for generation.
  if p_decision = 'rejected' then
    update consent_records
       set status = 'revoked',
           revoked_at = now(),
           revocation_reason = 'voice check rejected on human review'
     where id = p_consent_id;
  end if;

  perform append_audit(
    v_actor,
    'consent.voice_review_' || p_decision,
    'consent_records',
    p_consent_id,
    jsonb_build_object('note', p_note, 'org_id', v_org)
  );
end;
$$;

revoke all on function review_voice_check(uuid, text, text) from public;
grant execute on function review_voice_check(uuid, text, text) to authenticated;
