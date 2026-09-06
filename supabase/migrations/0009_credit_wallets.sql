-- Brand credit wallets: prepay once, license many times without per-video checkout.
create table credit_wallets (
  org_id uuid primary key references orgs(id) on delete cascade,
  balance_paise bigint not null default 0 check (balance_paise >= 0),
  updated_at timestamptz not null default now()
);
create table credit_ledger (
  id bigserial primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  delta_paise bigint not null,
  balance_after bigint not null,
  reason text not null check (reason in ('purchase','license_payment','refund','adjustment')),
  ref text,
  created_at timestamptz not null default now()
);
create index credit_ledger_org_idx on credit_ledger(org_id, id desc);

alter table credit_wallets enable row level security;
alter table credit_ledger enable row level security;
create policy wallet_select on credit_wallets for select
  using (org_id = (select org_id from profiles where id = auth.uid()));
create policy ledger_select on credit_ledger for select
  using (org_id = (select org_id from profiles where id = auth.uid()));
grant select on credit_wallets, credit_ledger to authenticated;

-- Buy credits. In mock payment mode this simulates the top-up directly; once
-- real Razorpay lands, top-ups arrive via the payment webhook instead.
create or replace function buy_credits(p_amount_paise bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_balance bigint;
begin
  select org_id into v_org from profiles where id = auth.uid() and role = 'buyer';
  if v_org is null then raise exception 'CREDITS:not_a_buyer'; end if;
  if p_amount_paise not in (999900, 2499900, 4999900) then
    raise exception 'CREDITS:invalid_pack';
  end if;
  insert into credit_wallets (org_id, balance_paise) values (v_org, p_amount_paise)
  on conflict (org_id) do update
    set balance_paise = credit_wallets.balance_paise + excluded.balance_paise,
        updated_at = now()
  returning balance_paise into v_balance;
  insert into credit_ledger (org_id, delta_paise, balance_after, reason, ref)
  values (v_org, p_amount_paise, v_balance, 'purchase', 'mock');
  perform append_audit(auth.uid(), 'credits.purchased', 'credit_wallets', v_org,
    jsonb_build_object('amount_paise', p_amount_paise, 'balance_paise', v_balance));
  return v_balance;
end $$;

-- Pay a payment_pending license from the wallet, then activate it through the
-- SAME activate_license path the payment webhook uses (single source of truth).
create or replace function pay_license_with_credits(p_license_id uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_lic licenses%rowtype; v_balance bigint;
begin
  select org_id into v_org from profiles where id = auth.uid() and role = 'buyer';
  if v_org is null then raise exception 'CREDITS:not_a_buyer'; end if;
  select * into v_lic from licenses where id = p_license_id for update;
  if not found or v_lic.buyer_org_id <> v_org then raise exception 'CREDITS:license_not_yours'; end if;
  if v_lic.status <> 'payment_pending' then raise exception 'CREDITS:not_payment_pending'; end if;
  update credit_wallets
    set balance_paise = balance_paise - v_lic.amount_paise, updated_at = now()
    where org_id = v_org and balance_paise >= v_lic.amount_paise
    returning balance_paise into v_balance;
  if v_balance is null then raise exception 'CREDITS:insufficient_balance'; end if;
  insert into credit_ledger (org_id, delta_paise, balance_after, reason, ref)
  values (v_org, -v_lic.amount_paise, v_balance, 'license_payment', p_license_id::text);
  perform activate_license(p_license_id, 'credits_' || p_license_id::text);
  return v_balance;
end $$;

revoke all on function buy_credits(bigint) from public, anon;
revoke all on function pay_license_with_credits(uuid) from public, anon;
grant execute on function buy_credits(bigint) to authenticated;
grant execute on function pay_license_with_credits(uuid) to authenticated;
