-- BomberCash · funções que movem dinheiro e estado crítico. Só o servidor (service_role) executa.
-- Parte A: utilitários, cadastro/KYC/bloqueio e depósitos PIX.

-- ---------------------------------------------------------------- utilitários
create function core.require_can(p_actor uuid, p_perm text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or not core.can(p_actor, p_perm) then
    raise exception 'forbidden: % requer %', coalesce(p_actor::text,'(sem usuario)'), p_perm using errcode = 'insufficient_privilege';
  end if;
end $$;

create function core.account_of(p_kind core.account_kind, p_owner uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from core.accounts where kind = p_kind and owner_id is not distinct from p_owner;
  if v is not null then return v; end if;
  if p_owner is null then
    insert into core.accounts (kind) values (p_kind) on conflict (kind) where owner_id is null do nothing;
  else
    insert into core.accounts (kind, owner_id) values (p_kind, p_owner) on conflict (kind, owner_id) where owner_id is not null do nothing;
  end if;
  select id into v from core.accounts where kind = p_kind and owner_id is not distinct from p_owner;
  return v;
end $$;

-- lançamento atômico e idempotente: mesma idem_key devolve a transação já feita, sem duplicar
create function core.post_txn(p_kind text, p_idem text, p_entries jsonb, p_meta jsonb default '{}') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_sum bigint; r record;
begin
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) < 2 then raise exception 'entries invalidas'; end if;
  select coalesce(sum((e->>'amount')::bigint),0) into v_sum from jsonb_array_elements(p_entries) e;
  if v_sum <> 0 then raise exception 'lancamento nao fecha em zero (%)', v_sum; end if;

  insert into core.txns (kind, idem_key, meta) values (p_kind, p_idem, coalesce(p_meta,'{}'))
    on conflict (idem_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from core.txns where idem_key = p_idem; return v_id; end if;

  perform 1 from core.accounts where id in (select (e->>'account')::uuid from jsonb_array_elements(p_entries) e) order by id for update;
  for r in select (e->>'account')::uuid as acc, sum((e->>'amount')::bigint) as amt from jsonb_array_elements(p_entries) e group by 1 loop
    if r.amt < 0 and exists (select 1 from core.accounts a where a.id = r.acc
         and a.kind in ('player_wallet','player_escrow','affiliate_payable','withdrawal_hold') and a.balance_cents + r.amt < 0) then
      raise exception 'insufficient_funds' using detail = r.acc::text;
    end if;
  end loop;

  insert into core.ledger_entries (txn_id, account_id, amount_cents)
    select v_id, (e->>'account')::uuid, (e->>'amount')::bigint from jsonb_array_elements(p_entries) e
    order by (e->>'amount')::bigint desc;                         -- créditos antes dos débitos
  return v_id;
end $$;

-- ---------------------------------------------------------------- cadastro, KYC, bloqueio
create function core.profile_create(p_user uuid, p_cpf_hash text, p_last4 text, p_name text, p_birth date, p_nick text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into core.profiles (user_id, cpf_hash, cpf_last4, full_name, birth_date, nickname) values (p_user, p_cpf_hash, p_last4, p_name, p_birth, p_nick);
  insert into core.user_roles (user_id, role) values (p_user, 'player');
  perform core.account_of('player_wallet', p_user);
  perform core.account_of('player_escrow', p_user);
  perform core.audit(p_user, 'profile.create', 'profile', p_user::text, jsonb_build_object('cpf_last4', p_last4));
end $$;

create function core.kyc_set(p_actor uuid, p_user uuid, p_status core.kyc_status) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_can(p_actor, 'kyc.review');
  update core.profiles set kyc = p_status where user_id = p_user;
  if not found then raise exception 'profile_not_found'; end if;
  perform core.audit(p_actor, 'kyc.set', 'profile', p_user::text, jsonb_build_object('status', p_status));
end $$;

create function core.account_block(p_actor uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_can(p_actor, 'account.block');
  update core.profiles set status = 'blocked' where user_id = p_user;
  if not found then raise exception 'profile_not_found'; end if;
  perform core.audit(p_actor, 'account.block', 'profile', p_user::text, jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------------- depósitos (PIX)
create table core.deposits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id),
  amount_cents bigint not null check (amount_cents > 0),
  status       core.deposit_status not null default 'pending',
  gateway      text not null,
  gateway_ref  text not null unique,
  qr_code      text,
  expires_at   timestamptz not null,
  paid_at      timestamptz,
  txn_id       uuid references core.txns(id),
  created_at   timestamptz not null default now()
);
create table core.webhook_events (
  id           bigserial primary key,
  provider     text not null,
  event_id     text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

create function core.webhook_record(p_provider text, p_event text, p_payload jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into core.webhook_events (provider, event_id, payload) values (p_provider, p_event, p_payload) on conflict (provider, event_id) do nothing;
  get diagnostics n = row_count;
  return n = 1;                       -- false = evento repetido, não processar de novo
end $$;

create function core.deposit_create(p_user uuid, p_amount bigint, p_gateway text, p_ref text, p_qr text, p_expires timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_status core.user_status;
begin
  if p_amount < core.setting_int('min_deposit_cents') then raise exception 'below_min_deposit'; end if;
  select status into v_status from core.profiles where user_id = p_user;
  if v_status is distinct from 'active' then raise exception 'account_not_active'; end if;
  insert into core.deposits (user_id, amount_cents, gateway, gateway_ref, qr_code, expires_at) values (p_user, p_amount, p_gateway, p_ref, p_qr, p_expires) returning id into v_id;
  return v_id;
end $$;

create function core.deposit_confirm(p_gateway_ref text, p_paid_cents bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d core.deposits;
begin
  select * into d from core.deposits where gateway_ref = p_gateway_ref for update;
  if not found then raise exception 'deposit_not_found'; end if;
  if d.status = 'paid' then return d.id; end if;                                   -- webhook repetido
  if d.status = 'cancelled' then raise exception 'deposit_cancelled'; end if;
  if p_paid_cents <> d.amount_cents then raise exception 'amount_mismatch'; end if; -- vai para revisão manual
  -- pagou depois de expirar? o dinheiro entrou, então credita
  update core.deposits set status = 'paid', paid_at = now(),
    txn_id = core.post_txn('deposit', 'dep:' || d.id, jsonb_build_array(
      jsonb_build_object('account', core.account_of('gateway_clearing'), 'amount', -d.amount_cents),
      jsonb_build_object('account', core.account_of('player_wallet', d.user_id), 'amount', d.amount_cents)),
      jsonb_build_object('deposit', d.id))
  where id = d.id;
  update core.profiles set deposited_cents = deposited_cents + d.amount_cents, first_deposit_at = coalesce(first_deposit_at, now()) where user_id = d.user_id;
  return d.id;
end $$;

alter table core.deposits enable row level security;
alter table core.webhook_events enable row level security;
