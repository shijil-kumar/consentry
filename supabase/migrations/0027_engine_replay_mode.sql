-- Engine replay mode.
--
-- WHY: Tavus and HeyGen are paid subscriptions. If either lapses, picking that
-- engine in a demo would fail at the render step and the whole story ("a brand
-- licenses, the star approves, the file is sealed") dies mid-sentence in front
-- of an investor. Replay keeps the ENTIRE pipeline real — gate, licence, wallet
-- debit, approval link, watermark burn-in, C2PA seal, delivery, verification —
-- and substitutes only the one step we can no longer pay for: the provider call.
-- In its place the engine's own previously-rendered output is used.
--
-- HONESTY: this must never be mistakable for a live render. Every generation
-- records how it was produced, and the UI says so wherever the video is shown.

alter table generations add column if not exists render_mode text
  not null default 'live' check (render_mode in ('live', 'replay'));

comment on column generations.render_mode is
  'live = the provider API actually rendered this. replay = the provider was '
  'unavailable or deliberately switched off, and a previously-rendered sample '
  'from that same engine stood in. Everything else in the pipeline was real.';

-- Per-engine switch. 'auto' is the important one: it uses the live API when a
-- key is configured and falls back to replay when it is not, so a cancelled
-- subscription degrades to a working demo instead of an error.
insert into platform_settings (key, value) values
  ('engine_mode_tavus',  '"auto"'::jsonb),
  ('engine_mode_heygen', '"auto"'::jsonb)
on conflict (key) do nothing;

-- Extend the admin-only guarded setter. Same shape as 0026: validate the value,
-- keep the key whitelist closed, and audit the change.
create or replace function update_platform_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    raise exception 'SETTINGS:admin_only';
  end if;
  if p_key = 'take_rate_bps' and (p_value::text)::int not between 0 and 5000 then
    raise exception 'SETTINGS:take_rate_out_of_range';
  end if;
  if p_key = 'payments_live' and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'SETTINGS:payments_live_must_be_boolean';
  end if;
  if p_key in ('engine_mode_tavus','engine_mode_heygen')
     and p_value #>> '{}' not in ('auto','live','replay') then
    raise exception 'SETTINGS:engine_mode_must_be_auto_live_or_replay';
  end if;
  if p_key not in ('take_rate_bps','credit_packs','payments_live',
                   'engine_mode_tavus','engine_mode_heygen') then
    raise exception 'SETTINGS:unknown_key';
  end if;
  insert into platform_settings (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform append_audit(auth.uid(), 'settings.updated', 'platform_settings', null,
    jsonb_build_object('key', p_key, 'value', p_value));
end $$;
