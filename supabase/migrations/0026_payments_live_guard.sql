-- Close the free-credit path before real launch.
--
-- PENTEST FINDING (2026-08-05): buy_credits() mints wallet credits after only
-- checking that the pack amount is valid — the ledger ref is hardcoded
-- 'mock:paid_…' and there is NO payment verification. Any authenticated buyer
-- can call it directly over PostgREST and receive credits for free, then spend
-- them via pay_license_with_credits to generate videos on the platform's
-- provider spend. This is correct and intended for the TEST-MODE demo (the whole
-- payment layer is mock today), but it is a critical payment bypass the moment
-- real money is involved.
--
-- Fix: a single platform switch, payments_live. While it is false/absent (the
-- demo), credits mint as before so nothing about the demo changes. Flip it to
-- true at launch and buy_credits refuses, forcing the real Razorpay →
-- webhook → activate_license path that already verifies a signed payment.

-- Seed the switch explicitly so its state is auditable, not merely "absent".
insert into platform_settings (key, value)
values ('payments_live', 'false'::jsonb)
on conflict (key) do nothing;

-- Allow admins to toggle it through the existing guarded RPC (which is itself
-- admin-only and audited). Without this the key is not in the whitelist.
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
  if p_key not in ('take_rate_bps','credit_packs','payments_live') then
    raise exception 'SETTINGS:unknown_key';
  end if;
  insert into platform_settings (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform append_audit(auth.uid(), 'settings.updated', 'platform_settings', null,
    jsonb_build_object('key', p_key, 'value', p_value));
end $$;

-- The guard itself: buy_credits refuses to mint free credits in live mode.
create or replace function buy_credits(p_amount_paise bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_balance bigint; v_bonus_bps int; v_credit bigint; v_live boolean;
begin
  -- Launch guard first: once payments are live, free minting is off and the
  -- caller must go through the real, signature-verified payment path.
  select coalesce((value)::boolean, false) into v_live from platform_settings where key = 'payments_live';
  if coalesce(v_live, false) then
    raise exception 'CREDITS:live_mode_use_checkout';
  end if;

  select org_id into v_org from profiles where id = auth.uid() and role = 'buyer';
  if v_org is null then raise exception 'CREDITS:not_a_buyer'; end if;
  select (p->>'bonus_bps')::int into v_bonus_bps
  from platform_settings s, jsonb_array_elements(s.value) p
  where s.key = 'credit_packs' and (p->>'amount_paise')::bigint = p_amount_paise;
  if v_bonus_bps is null then raise exception 'CREDITS:invalid_pack'; end if;
  v_credit := p_amount_paise + round(p_amount_paise * v_bonus_bps / 10000.0);
  insert into credit_wallets (org_id, balance_paise) values (v_org, v_credit)
  on conflict (org_id) do update
    set balance_paise = credit_wallets.balance_paise + excluded.balance_paise, updated_at = now()
  returning balance_paise into v_balance;
  insert into credit_ledger (org_id, delta_paise, balance_after, reason, ref)
  values (v_org, v_credit, v_balance, 'purchase', 'mock:paid_' || p_amount_paise || ':bonus_' || v_bonus_bps);
  perform append_audit(auth.uid(), 'credits.purchased', 'credit_wallets', v_org,
    jsonb_build_object('paid_paise', p_amount_paise, 'credited_paise', v_credit, 'balance_paise', v_balance));
  return v_balance;
end $$;
