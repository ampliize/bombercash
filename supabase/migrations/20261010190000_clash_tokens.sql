-- BomberCash · ClashToken: moeda de ouro do jogo (não é dinheiro, não se compra nem se saca).
-- 1 ClashToken por dia por conta (dia de Brasília). Serve de entrada na sala "Mata-mata 4 · ClashToken" (6 por jogador);
-- o vencedor leva o pote inteiro (24). Só o servidor de jogo (service_role) debita e paga partidas.

create table core.clash_wallets (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  last_claim date,
  updated_at timestamptz not null default now()
);
create table core.clash_log (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta      integer not null,
  reason     text not null check (reason in ('daily','match_entry','match_prize','match_refund')),
  match_id   uuid,
  created_at timestamptz not null default now()
);
create index clash_log_user_idx on core.clash_log (user_id, created_at desc);
create table core.clash_matches (
  match_id   uuid primary key,
  entry      integer not null check (entry > 0),
  users      uuid[] not null,
  state      text not null default 'open' check (state in ('open','settled','refunded')),
  winner     uuid,
  created_at timestamptz not null default now(),
  closed_at  timestamptz
);
alter table core.clash_wallets enable row level security;
alter table core.clash_log enable row level security;
alter table core.clash_matches enable row level security;

create function core.clash_today() returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date $$;

-- jogador logado: saldo e se já pode coletar hoje
create function public.clash_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare w core.clash_wallets; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'login'; end if;
  select * into w from core.clash_wallets where user_id = v_uid;
  return jsonb_build_object('balance', coalesce(w.balance, 0),
    'can_claim', exists(select 1 from core.profiles where user_id = v_uid) and (w.last_claim is null or w.last_claim < core.clash_today()),
    'next_at', ((core.clash_today() + 1)::timestamp at time zone 'America/Sao_Paulo'));
end $$;

-- coleta diária: 1 por conta por dia; precisa do cadastro (CPF) para não virar fazenda de contas
create function public.clash_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); w core.clash_wallets; v_today date := core.clash_today();
begin
  if v_uid is null then raise exception 'login'; end if;
  if not exists(select 1 from core.profiles where user_id = v_uid and status = 'active') then raise exception 'profile_required'; end if;
  insert into core.clash_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from core.clash_wallets where user_id = v_uid for update;
  if w.last_claim is not null and w.last_claim >= v_today then
    return jsonb_build_object('ok', false, 'error', 'already', 'balance', w.balance);
  end if;
  update core.clash_wallets set balance = balance + 1, last_claim = v_today, updated_at = now() where user_id = v_uid returning * into w;
  insert into core.clash_log (user_id, delta, reason) values (v_uid, 1, 'daily');
  return jsonb_build_object('ok', true, 'balance', w.balance);
end $$;

-- servidor de jogo: tira a entrada de todos antes da partida existir (se alguém não tiver, ninguém joga)
create function public.svc_clash_open(p_match uuid, p_entry integer, p_users uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid; b integer;
begin
  if exists(select 1 from core.clash_matches where match_id = p_match) then return jsonb_build_object('ok', true, 'repeat', true); end if;
  if p_entry <= 0 or coalesce(array_length(p_users, 1), 0) < 2 then raise exception 'args'; end if;
  perform 1 from core.clash_wallets where user_id = any(p_users) order by user_id for update;
  foreach u in array p_users loop
    select balance into b from core.clash_wallets where user_id = u;
    if coalesce(b, 0) < p_entry then raise exception 'insufficient_tokens' using detail = u::text; end if;
  end loop;
  foreach u in array p_users loop
    update core.clash_wallets set balance = balance - p_entry, updated_at = now() where user_id = u;
    insert into core.clash_log (user_id, delta, reason, match_id) values (u, -p_entry, 'match_entry', p_match);
  end loop;
  insert into core.clash_matches (match_id, entry, users) values (p_match, p_entry, p_users);
  return jsonb_build_object('ok', true);
end $$;

create function public.svc_clash_settle(p_match uuid, p_winner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m core.clash_matches; v_pot integer;
begin
  select * into m from core.clash_matches where match_id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if m.state = 'settled' then return jsonb_build_object('ok', true, 'repeat', true); end if;
  if m.state <> 'open' then raise exception 'match_closed'; end if;
  if not (p_winner = any(m.users)) then raise exception 'winner_not_in_match'; end if;
  v_pot := m.entry * array_length(m.users, 1);
  update core.clash_wallets set balance = balance + v_pot, updated_at = now() where user_id = p_winner;
  insert into core.clash_log (user_id, delta, reason, match_id) values (p_winner, v_pot, 'match_prize', p_match);
  update core.clash_matches set state = 'settled', winner = p_winner, closed_at = now() where match_id = p_match;
  return jsonb_build_object('ok', true, 'prize', v_pot);
end $$;

create function public.svc_clash_refund(p_match uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m core.clash_matches; u uuid;
begin
  select * into m from core.clash_matches where match_id = p_match for update;
  if not found then return jsonb_build_object('ok', true, 'none', true); end if;
  if m.state = 'refunded' then return jsonb_build_object('ok', true, 'repeat', true); end if;
  if m.state <> 'open' then raise exception 'match_closed'; end if;
  foreach u in array m.users loop
    update core.clash_wallets set balance = balance + m.entry, updated_at = now() where user_id = u;
    insert into core.clash_log (user_id, delta, reason, match_id) values (u, m.entry, 'match_refund', p_match);
  end loop;
  update core.clash_matches set state = 'refunded', closed_at = now() where match_id = p_match;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.clash_status(), public.clash_claim() from public, anon;
grant execute on function public.clash_status(), public.clash_claim() to authenticated;
revoke all on function public.svc_clash_open(uuid, integer, uuid[]), public.svc_clash_settle(uuid, uuid), public.svc_clash_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.svc_clash_open(uuid, integer, uuid[]), public.svc_clash_settle(uuid, uuid), public.svc_clash_refund(uuid, text) to service_role;
revoke all on function core.clash_today() from public;
