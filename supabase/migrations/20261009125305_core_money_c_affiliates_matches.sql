-- BomberCash · Parte C: afiliados, partidas (escrow, liquidação com rake, reembolso) e comissões.

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

alter table core.affiliates enable row level security;
alter table core.referrals enable row level security;
alter table core.affiliate_commissions enable row level security;
alter table core.matches enable row level security;
alter table core.match_players enable row level security;
