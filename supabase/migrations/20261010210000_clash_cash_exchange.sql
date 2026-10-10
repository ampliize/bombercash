-- ClashToken vira dinheiro: R$ 2,00 pagos pelo caixa da empresa (conta house_rake, a mesma que recebe os 20%).
--  * vencedor da sala dourada: em vez dos 24 tokens do pote, recebe R$ 2,00 no saldo, automaticamente, no fim da partida;
--  * troca direta: qualquer conta com cadastro troca 6 ClashTokens por R$ 2,00 no saldo.
-- Sala dourada só para quem fez pelo menos 1 depósito de R$ 10,00 ou mais nas últimas 3 semanas (21 dias).

alter table core.clash_log drop constraint clash_log_reason_check;
alter table core.clash_log add constraint clash_log_reason_check check (reason in ('daily','match_entry','match_prize','match_refund','exchange'));
alter table core.clash_matches add column prize_cents bigint;

create function core.clash_deposit_until(p_user uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(paid_at) + interval '21 days' from core.deposits
   where user_id = p_user and status = 'paid' and amount_cents >= 1000 and paid_at >= now() - interval '21 days' $$;
revoke all on function core.clash_deposit_until(uuid) from public;

create or replace function public.clash_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare w core.clash_wallets; v_uid uuid := auth.uid(); v_next timestamptz; v_dep timestamptz;
begin
  if v_uid is null then raise exception 'login'; end if;
  select * into w from core.clash_wallets where user_id = v_uid;
  v_next := case when w.last_claim_at is null then now() else w.last_claim_at + interval '24 hours' end;
  v_dep := core.clash_deposit_until(v_uid);
  return jsonb_build_object('balance', coalesce(w.balance, 0),
    'can_claim', exists(select 1 from core.profiles where user_id = v_uid) and now() >= v_next,
    'next_at', v_next, 'last_at', w.last_claim_at,
    'deposit_ok', v_dep is not null, 'deposit_until', v_dep,
    'exchange_tokens', 6, 'exchange_cents', 200);
end $$;

-- troca direta: 6 ClashTokens -> R$ 2,00 no saldo
create function public.clash_exchange() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); w core.clash_wallets; v_log bigint;
begin
  if v_uid is null then raise exception 'login'; end if;
  if not exists(select 1 from core.profiles where user_id = v_uid and status = 'active') then raise exception 'profile_required'; end if;
  select * into w from core.clash_wallets where user_id = v_uid for update;
  if not found or w.balance < 6 then return jsonb_build_object('ok', false, 'error', 'insufficient_tokens', 'balance', coalesce(w.balance, 0)); end if;
  update core.clash_wallets set balance = balance - 6, updated_at = now() where user_id = v_uid returning * into w;
  insert into core.clash_log (user_id, delta, reason) values (v_uid, -6, 'exchange') returning id into v_log;
  perform core.post_txn('clash_exchange', 'clx:' || v_log, jsonb_build_array(
    jsonb_build_object('account', core.account_of('house_rake'), 'amount', -200),
    jsonb_build_object('account', core.account_of('player_wallet', v_uid), 'amount', 200)), jsonb_build_object('clash_log', v_log));
  return jsonb_build_object('ok', true, 'balance', w.balance, 'credited_cents', 200);
end $$;

-- entrada na sala dourada: tokens suficientes E depósito nas últimas 3 semanas para todos
create or replace function public.svc_clash_open(p_match uuid, p_entry integer, p_users uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid; b integer;
begin
  if exists(select 1 from core.clash_matches where match_id = p_match) then return jsonb_build_object('ok', true, 'repeat', true); end if;
  if p_entry <= 0 or coalesce(array_length(p_users, 1), 0) < 2 then raise exception 'args'; end if;
  perform 1 from core.clash_wallets where user_id = any(p_users) order by user_id for update;
  foreach u in array p_users loop
    if core.clash_deposit_until(u) is null then raise exception 'deposit_required' using detail = u::text; end if;
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

-- vencedor: os tokens do pote são trocados por R$ 2,00, pagos automaticamente pelo caixa da empresa
create or replace function public.svc_clash_settle(p_match uuid, p_winner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m core.clash_matches;
begin
  select * into m from core.clash_matches where match_id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if m.state = 'settled' then return jsonb_build_object('ok', true, 'repeat', true, 'prize_cents', m.prize_cents); end if;
  if m.state <> 'open' then raise exception 'match_closed'; end if;
  if not (p_winner = any(m.users)) then raise exception 'winner_not_in_match'; end if;
  perform core.post_txn('clash_prize', 'clp:' || p_match, jsonb_build_array(
    jsonb_build_object('account', core.account_of('house_rake'), 'amount', -200),
    jsonb_build_object('account', core.account_of('player_wallet', p_winner), 'amount', 200)), jsonb_build_object('match', p_match));
  insert into core.clash_log (user_id, delta, reason, match_id) values (p_winner, 0, 'match_prize', p_match);
  update core.clash_matches set state = 'settled', winner = p_winner, prize_cents = 200, closed_at = now() where match_id = p_match;
  return jsonb_build_object('ok', true, 'prize_cents', 200);
end $$;

revoke all on function public.clash_status(), public.clash_exchange() from public, anon;
grant execute on function public.clash_status(), public.clash_exchange() to authenticated;
revoke all on function public.svc_clash_open(uuid, integer, uuid[]), public.svc_clash_settle(uuid, uuid) from public, anon, authenticated;
grant execute on function public.svc_clash_open(uuid, integer, uuid[]), public.svc_clash_settle(uuid, uuid) to service_role;
