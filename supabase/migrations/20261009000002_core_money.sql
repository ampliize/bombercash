-- BomberCash · funções que movem dinheiro e estado crítico. Só o servidor (service_role) executa.
-- Regras do PRD: rake 20% do pote (vencedor leva o resto), saque híbrido, carência + rollover,
-- comissão de afiliado sobre o RAKE da 1ª partida do indicado, mudança de percentuais com 2ª aprovação.

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

-- ---------------------------------------------------------------- saques (PIX): híbrido, carência, rollover, titularidade do CPF
create table core.withdrawals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id),
  amount_cents   bigint not null check (amount_cents > 0),
  pix_key_masked text not null,
  status         core.withdrawal_status not null,
  flags          jsonb not null default '[]',
  requested_at   timestamptz not null default now(),
  reviewed_by    uuid references auth.users(id),
  reviewed_at    timestamptz,
  review_note    text,
  gateway_ref    text,
  hold_txn       uuid references core.txns(id),
  done_txn       uuid references core.txns(id)
);
create index withdrawals_user_idx on core.withdrawals (user_id, requested_at desc);
create index withdrawals_status_idx on core.withdrawals (status);

create function core.withdrawal_request(p_user uuid, p_amount bigint, p_pix_masked text, p_pix_cpf_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p core.profiles; v_id uuid := gen_random_uuid(); v_flags jsonb := '[]'; v_status core.withdrawal_status; v_today bigint; v_txn uuid;
begin
  select * into p from core.profiles where user_id = p_user for update;
  if not found then raise exception 'profile_not_found'; end if;
  if p.status <> 'active' then raise exception 'account_not_active'; end if;
  if p.kyc <> 'approved' then raise exception 'kyc_required'; end if;
  if p_pix_cpf_hash is distinct from p.cpf_hash then raise exception 'pix_owner_mismatch'; end if;     -- só para chave do mesmo CPF
  if p_amount < core.setting_int('min_withdraw_cents') then raise exception 'below_min_withdraw'; end if;
  if p.first_deposit_at is null or now() < p.first_deposit_at + make_interval(hours => core.setting_int('withdraw_hold_hours')::int) then raise exception 'withdraw_hold'; end if;
  if p.wagered_cents * 10000 < p.deposited_cents * core.setting_int('rollover_bps') then raise exception 'rollover_not_met'; end if;
  select coalesce(sum(amount_cents),0) into v_today from core.withdrawals
    where user_id = p_user and requested_at >= date_trunc('day', now()) and status not in ('rejected','failed');
  if v_today + p_amount > core.setting_int('withdraw_daily_max_cents') then raise exception 'daily_limit'; end if;

  if p.created_at > now() - interval '72 hours' then v_flags := v_flags || '"new_account"'; end if;
  v_status := case when p_amount <= core.setting_int('withdraw_auto_max_cents') and jsonb_array_length(v_flags) = 0 then 'approved' else 'pending_review' end;

  v_txn := core.post_txn('withdrawal_hold', 'wdh:' || v_id, jsonb_build_array(
    jsonb_build_object('account', core.account_of('player_wallet', p_user), 'amount', -p_amount),
    jsonb_build_object('account', core.account_of('withdrawal_hold'), 'amount', p_amount)), jsonb_build_object('withdrawal', v_id));
  insert into core.withdrawals (id, user_id, amount_cents, pix_key_masked, status, flags, hold_txn) values (v_id, p_user, p_amount, p_pix_masked, v_status, v_flags, v_txn);
  return jsonb_build_object('id', v_id, 'status', v_status, 'flags', v_flags);
end $$;

create function core.withdrawal_review(p_actor uuid, p_id uuid, p_approve boolean, p_note text default null) returns core.withdrawal_status
language plpgsql security definer set search_path = '' as $$
declare w core.withdrawals;
begin
  perform core.require_can(p_actor, 'withdrawal.review');
  select * into w from core.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal_not_found'; end if;
  if w.status <> 'pending_review' then raise exception 'not_pending_review'; end if;
  if w.user_id = p_actor then raise exception 'cannot_review_own_withdrawal'; end if;
  if p_approve then
    update core.withdrawals set status = 'approved', reviewed_by = p_actor, reviewed_at = now(), review_note = p_note where id = p_id;
  else
    perform core.post_txn('withdrawal_reject', 'wdr:' || p_id, jsonb_build_array(
      jsonb_build_object('account', core.account_of('withdrawal_hold'), 'amount', -w.amount_cents),
      jsonb_build_object('account', core.account_of('player_wallet', w.user_id), 'amount', w.amount_cents)), jsonb_build_object('withdrawal', p_id));
    update core.withdrawals set status = 'rejected', reviewed_by = p_actor, reviewed_at = now(), review_note = p_note where id = p_id;
  end if;
  perform core.audit(p_actor, case when p_approve then 'withdrawal.approve' else 'withdrawal.reject' end, 'withdrawal', p_id::text, jsonb_build_object('note', p_note, 'amount', w.amount_cents));
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

create function core.withdrawal_mark_sent(p_id uuid, p_gateway_ref text) returns void
language plpgsql security definer set search_path = '' as $$
declare w core.withdrawals;
begin
  select * into w from core.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal_not_found'; end if;
  if w.status = 'sent' then return; end if;
  if w.status <> 'approved' then raise exception 'not_approved'; end if;
  update core.withdrawals set status = 'sent', gateway_ref = p_gateway_ref,
    done_txn = core.post_txn('withdrawal_sent', 'wds:' || p_id, jsonb_build_array(
      jsonb_build_object('account', core.account_of('withdrawal_hold'), 'amount', -w.amount_cents),
      jsonb_build_object('account', core.account_of('gateway_clearing'), 'amount', w.amount_cents)), jsonb_build_object('withdrawal', p_id))
  where id = p_id;
end $$;

create function core.withdrawal_mark_failed(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare w core.withdrawals;
begin
  select * into w from core.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal_not_found'; end if;
  if w.status = 'failed' then return; end if;
  if w.status <> 'approved' then raise exception 'not_approved'; end if;
  update core.withdrawals set status = 'failed', review_note = p_reason,
    done_txn = core.post_txn('withdrawal_failed', 'wdf:' || p_id, jsonb_build_array(
      jsonb_build_object('account', core.account_of('withdrawal_hold'), 'amount', -w.amount_cents),
      jsonb_build_object('account', core.account_of('player_wallet', w.user_id), 'amount', w.amount_cents)), jsonb_build_object('withdrawal', p_id))
  where id = p_id;
end $$;

-- ---------------------------------------------------------------- afiliados
create table core.affiliates (
  user_id        uuid primary key references auth.users(id),
  code           text not null unique check (code ~ '^[A-Za-z0-9]{4,20}$'),
  commission_bps int check (commission_bps between 0 and 10000),      -- null = usa o padrão das configurações
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create table core.referrals (
  referred_id      uuid primary key references auth.users(id),
  affiliate_id     uuid not null references core.affiliates(user_id),
  created_at       timestamptz not null default now(),
  first_match_done boolean not null default false,
  check (referred_id <> affiliate_id)
);
create table core.affiliate_commissions (
  id           bigserial primary key,
  affiliate_id uuid not null references core.affiliates(user_id),
  referred_id  uuid not null references auth.users(id),
  match_id     uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  status       core.commission_status not null default 'pending',
  release_at   timestamptz not null,
  txn_id       uuid references core.txns(id),
  unique (match_id, referred_id)
);

create function core.affiliate_create(p_actor uuid, p_user uuid, p_code text, p_bps int default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_can(p_actor, 'affiliate.manage');
  insert into core.affiliates (user_id, code, commission_bps) values (p_user, p_code, p_bps);
  insert into core.user_roles (user_id, role, granted_by) values (p_user, 'affiliate', p_actor) on conflict do nothing;
  perform core.audit(p_actor, 'affiliate.create', 'affiliate', p_user::text, jsonb_build_object('code', p_code, 'bps', p_bps));
end $$;

create function core.referral_register(p_referred uuid, p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare a uuid; n int;
begin
  select user_id into a from core.affiliates where lower(code) = lower(p_code) and active;
  if a is null or a = p_referred then return false; end if;
  if exists (select 1 from core.match_players where user_id = p_referred) then return false; end if;   -- só vale antes da 1ª partida
  insert into core.referrals (referred_id, affiliate_id) values (p_referred, a) on conflict do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ---------------------------------------------------------------- partidas: escrow, liquidação (rake 20%), reembolso
create table core.matches (
  id           uuid primary key,
  mode         text not null check (mode in ('1x1','4x4','8x8')),
  stake_cents  bigint not null check (stake_cents > 0),
  humans       int not null check (humans >= 2),
  status       core.match_status not null default 'open',
  seed         text,
  result_hash  text,
  winner_id    uuid references auth.users(id),
  rake_cents   bigint,
  prize_cents  bigint,
  refund_reason text,
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz
);
create table core.match_players (
  match_id    uuid not null references core.matches(id),
  user_id     uuid not null references auth.users(id),
  slot        int  not null,
  stake_cents bigint not null,
  primary key (match_id, user_id)
);
create index match_players_user_idx on core.match_players (user_id);
alter table core.affiliate_commissions add constraint commissions_match_fk foreign key (match_id) references core.matches(id);

create function core.match_open(p_match uuid, p_mode text, p_stake bigint, p_users uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid; i int := 0; bad boolean;
begin
  if not exists (
       select 1 from core.settings s, jsonb_array_elements_text(s.value) e where s.key = 'allowed_stakes_cents' and e::bigint = p_stake) then
    raise exception 'stake_not_allowed';
  end if;
  if p_stake < core.setting_int('min_bet_cents') then raise exception 'stake_not_allowed'; end if;
  if coalesce(array_length(p_users,1),0) < 2 or (select count(distinct x) from unnest(p_users) x) <> array_length(p_users,1) then raise exception 'invalid_players'; end if;
  insert into core.matches (id, mode, stake_cents, humans) values (p_match, p_mode, p_stake, array_length(p_users,1));
  foreach u in array p_users loop
    i := i + 1;
    select not (status = 'active' and kyc = 'approved') into bad from core.profiles where user_id = u;
    if bad is null or bad then raise exception 'player_not_eligible'; end if;
    if exists (select 1 from core.match_players mp join core.matches m on m.id = mp.match_id where mp.user_id = u and m.status = 'open' and m.id <> p_match) then raise exception 'already_in_match'; end if;
    perform core.post_txn('match_escrow', 'mo:' || p_match || ':' || u, jsonb_build_array(
      jsonb_build_object('account', core.account_of('player_wallet', u), 'amount', -p_stake),
      jsonb_build_object('account', core.account_of('player_escrow', u), 'amount', p_stake)), jsonb_build_object('match', p_match));   -- falta de saldo aborta tudo
    insert into core.match_players (match_id, user_id, slot, stake_cents) values (p_match, u, i - 1, p_stake);
  end loop;
end $$;

create function core.match_settle(p_match uuid, p_winner uuid, p_seed text, p_result_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m core.matches; v_pot bigint; v_rake bigint; v_prize bigint; v_entries jsonb := '[]'; v_txn uuid; r record; v_share bigint; v_c bigint; v_def bigint; v_comms jsonb := '[]'; c jsonb;
begin
  select * into m from core.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if m.status = 'settled' then return jsonb_build_object('status','settled','idempotent',true,'winner',m.winner_id,'prize',m.prize_cents,'rake',m.rake_cents); end if;
  if m.status <> 'open' then raise exception 'match_not_open'; end if;
  if not exists (select 1 from core.match_players where match_id = p_match and user_id = p_winner) then raise exception 'winner_not_in_match'; end if;

  v_pot := m.stake_cents * m.humans;
  v_rake := (v_pot * core.setting_int('rake_bps')) / 10000;       -- arredonda para baixo; a sobra fica com o vencedor
  v_prize := v_pot - v_rake;
  v_def := core.setting_int('affiliate_first_match_bps');
  v_share := v_rake / m.humans;                                   -- parte do rake gerada por cada jogador

  for r in select user_id, stake_cents from core.match_players where match_id = p_match order by slot loop
    v_entries := v_entries || jsonb_build_array(jsonb_build_object('account', core.account_of('player_escrow', r.user_id), 'amount', -r.stake_cents));
  end loop;
  v_entries := v_entries || jsonb_build_array(
    jsonb_build_object('account', core.account_of('player_wallet', p_winner), 'amount', v_prize),
    jsonb_build_object('account', core.account_of('house_rake'), 'amount', v_rake));

  for r in select mp.user_id as referred, rf.affiliate_id, af.commission_bps
             from core.match_players mp
             join core.referrals rf on rf.referred_id = mp.user_id and not rf.first_match_done
             join core.affiliates af on af.user_id = rf.affiliate_id and af.active
             join core.profiles pr on pr.user_id = mp.user_id and pr.kyc = 'approved'
            where mp.match_id = p_match loop
    v_c := (v_share * coalesce(r.commission_bps, v_def)) / 10000;   -- nunca passa do rake gerado por aquele jogador
    if v_c > 0 then
      v_entries := v_entries || jsonb_build_array(
        jsonb_build_object('account', core.account_of('house_rake'), 'amount', -v_c),
        jsonb_build_object('account', core.account_of('affiliate_payable', r.affiliate_id), 'amount', v_c));
      v_comms := v_comms || jsonb_build_array(jsonb_build_object('aff', r.affiliate_id, 'ref', r.referred, 'amt', v_c));
    end if;
  end loop;

  v_txn := core.post_txn('match_settle', 'ms:' || p_match, v_entries, jsonb_build_object('match', p_match, 'winner', p_winner, 'pot', v_pot, 'rake', v_rake));
  update core.matches set status = 'settled', winner_id = p_winner, seed = p_seed, result_hash = p_result_hash, rake_cents = v_rake, prize_cents = v_prize, closed_at = now() where id = p_match;
  update core.profiles set wagered_cents = wagered_cents + m.stake_cents where user_id in (select user_id from core.match_players where match_id = p_match);
  for c in select * from jsonb_array_elements(v_comms) loop
    insert into core.affiliate_commissions (affiliate_id, referred_id, match_id, amount_cents, release_at, txn_id)
      values ((c->>'aff')::uuid, (c->>'ref')::uuid, p_match, (c->>'amt')::bigint, now() + make_interval(hours => core.setting_int('commission_hold_hours')::int), v_txn);
  end loop;
  update core.referrals set first_match_done = true where referred_id in (select user_id from core.match_players where match_id = p_match);
  return jsonb_build_object('status','settled','winner',p_winner,'pot',v_pot,'rake',v_rake,'prize',v_prize,'commissions',v_comms);
end $$;

create function core.match_refund(p_match uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare m core.matches; v_entries jsonb := '[]'; r record;
begin
  select * into m from core.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if m.status = 'refunded' then return; end if;
  if m.status <> 'open' then raise exception 'match_not_open'; end if;
  for r in select user_id, stake_cents from core.match_players where match_id = p_match loop
    v_entries := v_entries || jsonb_build_array(
      jsonb_build_object('account', core.account_of('player_escrow', r.user_id), 'amount', -r.stake_cents),
      jsonb_build_object('account', core.account_of('player_wallet', r.user_id), 'amount', r.stake_cents));
  end loop;
  perform core.post_txn('match_refund', 'mr:' || p_match, v_entries, jsonb_build_object('match', p_match, 'reason', p_reason));
  update core.matches set status = 'refunded', refund_reason = p_reason, closed_at = now() where id = p_match;
end $$;

-- ---------------------------------------------------------------- comissões
create function core.commission_release_due() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update core.affiliate_commissions set status = 'released' where status = 'pending' and release_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

create function core.commission_payout(p_affiliate uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_sum bigint; v_stamp text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
begin
  select coalesce(sum(amount_cents),0) into v_sum from core.affiliate_commissions where affiliate_id = p_affiliate and status = 'released';
  if v_sum = 0 then return 0; end if;
  perform core.post_txn('commission_payout', 'cp:' || p_affiliate || ':' || v_stamp, jsonb_build_array(
    jsonb_build_object('account', core.account_of('affiliate_payable', p_affiliate), 'amount', -v_sum),
    jsonb_build_object('account', core.account_of('player_wallet', p_affiliate), 'amount', v_sum)), jsonb_build_object('affiliate', p_affiliate));
  update core.affiliate_commissions set status = 'paid' where affiliate_id = p_affiliate and status = 'released';
  return v_sum;
end $$;

-- ---------------------------------------------------------------- configurações com aprovação dupla e papéis
create function core.setting_request(p_actor uuid, p_key text, p_value jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform core.require_can(p_actor, 'settings.request');
  if not exists (select 1 from core.settings where key = p_key) then raise exception 'unknown_setting'; end if;
  if p_key like '%\_bps' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 0 and 10000) then raise exception 'invalid_value'; end if;
  insert into core.setting_changes (key, new_value, requested_by) values (p_key, p_value, p_actor) returning id into v_id;
  perform core.audit(p_actor, 'setting.request', 'setting', p_key, jsonb_build_object('value', p_value, 'change', v_id));
  return v_id;
end $$;

create function core.setting_approve(p_actor uuid, p_change bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare c core.setting_changes;
begin
  perform core.require_can(p_actor, 'settings.approve');
  select * into c from core.setting_changes where id = p_change for update;
  if not found then raise exception 'change_not_found'; end if;
  if c.status <> 'pending' then raise exception 'change_not_pending'; end if;
  if c.requested_by = p_actor then raise exception 'cannot_approve_own_change'; end if;
  update core.setting_changes set status = 'approved', approved_by = p_actor, approved_at = now() where id = p_change;
  update core.settings set value = c.new_value, updated_by = p_actor, updated_at = now() where key = c.key;   -- vale só para partidas futuras
  perform core.audit(p_actor, 'setting.approve', 'setting', c.key, jsonb_build_object('value', c.new_value, 'change', p_change));
end $$;

create function core.role_grant(p_actor uuid, p_user uuid, p_role core.app_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_can(p_actor, 'roles.grant');
  if p_actor = p_user then raise exception 'cannot_grant_to_self'; end if;
  insert into core.user_roles (user_id, role, granted_by) values (p_user, p_role, p_actor) on conflict do nothing;
  perform core.audit(p_actor, 'role.grant', 'user', p_user::text, jsonb_build_object('role', p_role));
end $$;

create function core.role_revoke(p_actor uuid, p_user uuid, p_role core.app_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_can(p_actor, 'roles.grant');
  delete from core.user_roles where user_id = p_user and role = p_role;
  perform core.audit(p_actor, 'role.revoke', 'user', p_user::text, jsonb_build_object('role', p_role));
end $$;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'core' and not rowsecurity loop
    execute format('alter table core.%I enable row level security', t);
  end loop;
end $$;
