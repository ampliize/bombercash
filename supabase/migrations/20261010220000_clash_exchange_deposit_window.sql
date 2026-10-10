-- Troca de 6 ClashTokens por R$ 2,00: liberada enquanto o jogador estiver dentro das 3 semanas do último depósito
-- de R$ 10,00 ou mais. Passou da 3ª semana, precisa de uma nova recarga mínima (R$ 10,00) para trocar de novo.
create or replace function public.clash_exchange() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); w core.clash_wallets; v_log bigint;
begin
  if v_uid is null then raise exception 'login'; end if;
  if not exists(select 1 from core.profiles where user_id = v_uid and status = 'active') then raise exception 'profile_required'; end if;
  if core.clash_deposit_until(v_uid) is null then return jsonb_build_object('ok', false, 'error', 'deposit_required'); end if;
  select * into w from core.clash_wallets where user_id = v_uid for update;
  if not found or w.balance < 6 then return jsonb_build_object('ok', false, 'error', 'insufficient_tokens', 'balance', coalesce(w.balance, 0)); end if;
  update core.clash_wallets set balance = balance - 6, updated_at = now() where user_id = v_uid returning * into w;
  insert into core.clash_log (user_id, delta, reason) values (v_uid, -6, 'exchange') returning id into v_log;
  perform core.post_txn('clash_exchange', 'clx:' || v_log, jsonb_build_array(
    jsonb_build_object('account', core.account_of('house_rake'), 'amount', -200),
    jsonb_build_object('account', core.account_of('player_wallet', v_uid), 'amount', 200)), jsonb_build_object('clash_log', v_log));
  return jsonb_build_object('ok', true, 'balance', w.balance, 'credited_cents', 200);
end $$;
revoke all on function public.clash_exchange() from public, anon;
grant execute on function public.clash_exchange() to authenticated;
