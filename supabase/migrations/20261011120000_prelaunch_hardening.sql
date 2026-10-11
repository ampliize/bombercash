-- BomberCash · endurecimento de pré-lançamento (auditoria de 11/10/2026)
-- 1) varredura que devolve partidas presas no escrow; 2) checagem de elegibilidade antes da fila;
-- 3) webhook PIX processado numa transação só; 4) limite de cobranças PIX pendentes;
-- 5) ClashToken: KYC aprovado + teto diário global de pagamentos do caixa; 6) índice de depósitos.

create extension if not exists pg_cron;

create index if not exists deposits_user_paid_idx on core.deposits (user_id, paid_at) where status = 'paid';

-- 1) partidas abertas há mais de 10 minutos = o servidor não liquidou (caiu, reiniciou, perdeu a resposta): devolve a entrada
create or replace function core.match_sweep() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; n_m int := 0; n_c int := 0;
begin
  for r in select id from core.matches where status = 'open' and opened_at < now() - interval '10 minutes' loop
    begin perform core.match_refund(r.id, 'varredura: partida não liquidada pelo servidor'); n_m := n_m + 1;
    exception when others then raise warning 'match_sweep %: %', r.id, sqlerrm; end;
  end loop;
  for r in select match_id from core.clash_matches where state = 'open' and created_at < now() - interval '10 minutes' loop
    begin perform public.svc_clash_refund(r.match_id, 'varredura'); n_c := n_c + 1;
    exception when others then raise warning 'clash_sweep %: %', r.match_id, sqlerrm; end;
  end loop;
  return jsonb_build_object('matches', n_m, 'clash', n_c);
end $$;
revoke all on function core.match_sweep() from public;
select cron.schedule('bombercash-sweep', '*/2 * * * *', 'select core.match_sweep()');

-- 2) antes de entrar na fila: conta ativa, cadastro aprovado, saldo e nenhuma partida aberta (evita derrubar a sala dos outros)
create or replace function public.svc_can_play(p_user uuid, p_stake bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p core.profiles; v_bal bigint;
begin
  select * into p from core.profiles where user_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'profile_required'); end if;
  if p.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'account_not_active'); end if;
  if p.kyc <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'kyc_required'); end if;
  select balance_cents into v_bal from core.accounts where kind = 'player_wallet' and owner_id = p_user;
  if coalesce(v_bal, 0) < p_stake then return jsonb_build_object('ok', false, 'reason', 'insufficient_funds'); end if;
  if exists (select 1 from core.match_players mp join core.matches m on m.id = mp.match_id where mp.user_id = p_user and m.status = 'open')
    then return jsonb_build_object('ok', false, 'reason', 'already_in_match'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.svc_clash_can_play(p_user uuid, p_entry integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p core.profiles; b integer;
begin
  select * into p from core.profiles where user_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'profile_required'); end if;
  if p.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'account_not_active'); end if;
  if p.kyc <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'kyc_required'); end if;
  if core.clash_deposit_until(p_user) is null then return jsonb_build_object('ok', false, 'reason', 'deposit_required'); end if;
  select balance into b from core.clash_wallets where user_id = p_user;
  if coalesce(b, 0) < p_entry then return jsonb_build_object('ok', false, 'reason', 'insufficient_tokens'); end if;
  if exists (select 1 from core.clash_matches where state = 'open' and p_user = any(users))
    then return jsonb_build_object('ok', false, 'reason', 'already_in_match'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- 3) webhook: registra o evento e credita na MESMA transação; se creditar falhar, nada fica registrado e a reentrega funciona
create or replace function public.svc_webhook_deposit(p_provider text, p_event text, p_payload jsonb, p_ref text, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_done timestamptz; v_dep uuid;
begin
  insert into core.webhook_events (provider, event_id, payload) values (p_provider, p_event, p_payload) on conflict (provider, event_id) do nothing;
  select processed_at into v_done from core.webhook_events where provider = p_provider and event_id = p_event for update;
  if v_done is not null then return jsonb_build_object('ok', true, 'repeated', true); end if;
  v_dep := core.deposit_confirm(p_ref, p_amount);
  update core.webhook_events set processed_at = now() where provider = p_provider and event_id = p_event;
  return jsonb_build_object('ok', true, 'deposit', v_dep);
end $$;

-- 4) no máximo 5 cobranças PIX pendentes criadas nos últimos 30 minutos por jogador (evita spam no gateway)
create or replace function public.svc_deposit_can_create(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from core.deposits where user_id = p_user and status = 'pending' and created_at > now() - interval '30 minutes') < 5
     and exists (select 1 from core.profiles where user_id = p_user and status = 'active') $$;

-- 5) ClashToken: pagamentos do caixa (troca e prêmio da sala dourada) com teto global de R$ 300,00 por dia e só para cadastro aprovado
create or replace function core.clash_cap_ok(p_cents bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select count(*) * 200 from core.txns where kind in ('clash_exchange','clash_prize') and created_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), 0) + p_cents <= 30000 $$;
revoke all on function core.clash_cap_ok(bigint) from public;

create or replace function public.clash_exchange() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); w core.clash_wallets; v_log bigint;
begin
  if v_uid is null then raise exception 'login'; end if;
  if not exists(select 1 from core.profiles where user_id = v_uid and status = 'active' and kyc = 'approved') then return jsonb_build_object('ok', false, 'error', 'kyc_required'); end if;
  if core.clash_deposit_until(v_uid) is null then return jsonb_build_object('ok', false, 'error', 'deposit_required'); end if;
  if not core.clash_cap_ok(200) then return jsonb_build_object('ok', false, 'error', 'daily_cap'); end if;
  select * into w from core.clash_wallets where user_id = v_uid for update;
  if not found or w.balance < 6 then return jsonb_build_object('ok', false, 'error', 'insufficient_tokens', 'balance', coalesce(w.balance, 0)); end if;
  update core.clash_wallets set balance = balance - 6, updated_at = now() where user_id = v_uid returning * into w;
  insert into core.clash_log (user_id, delta, reason) values (v_uid, -6, 'exchange') returning id into v_log;
  perform core.post_txn('clash_exchange', 'clx:' || v_log, jsonb_build_array(
    jsonb_build_object('account', core.account_of('house_rake'), 'amount', -200),
    jsonb_build_object('account', core.account_of('player_wallet', v_uid), 'amount', 200)), jsonb_build_object('clash_log', v_log));
  return jsonb_build_object('ok', true, 'balance', w.balance, 'credited_cents', 200);
end $$;

create or replace function public.svc_clash_open(p_match uuid, p_entry integer, p_users uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid; b integer;
begin
  if exists(select 1 from core.clash_matches where match_id = p_match) then return jsonb_build_object('ok', true, 'repeat', true); end if;
  if p_entry <= 0 or coalesce(array_length(p_users, 1), 0) < 2 or (select count(distinct x) from unnest(p_users) x) <> array_length(p_users, 1) then raise exception 'args'; end if;
  if not core.clash_cap_ok(200) then raise exception 'daily_cap'; end if;
  perform 1 from core.clash_wallets where user_id = any(p_users) order by user_id for update;
  foreach u in array p_users loop
    if not exists(select 1 from core.profiles where user_id = u and status = 'active' and kyc = 'approved') then raise exception 'player_not_eligible' using detail = u::text; end if;
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

revoke all on function public.svc_can_play(uuid, bigint), public.svc_clash_can_play(uuid, integer), public.svc_webhook_deposit(text, text, jsonb, text, bigint), public.svc_deposit_can_create(uuid), public.svc_clash_open(uuid, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.svc_can_play(uuid, bigint), public.svc_clash_can_play(uuid, integer), public.svc_webhook_deposit(text, text, jsonb, text, bigint), public.svc_deposit_can_create(uuid), public.svc_clash_open(uuid, integer, uuid[]) to service_role;
revoke all on function public.clash_exchange() from public, anon;
grant execute on function public.clash_exchange() to authenticated;

-- modo de teste: confere se a cobrança é do próprio jogador antes de simular o pagamento
create or replace function public.svc_deposit_owner(p_ref text, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from core.deposits where gateway_ref = p_ref and user_id = p_user and status = 'pending') $$;
revoke all on function public.svc_deposit_owner(text, uuid) from public, anon, authenticated;
grant execute on function public.svc_deposit_owner(text, uuid) to service_role;
