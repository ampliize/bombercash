-- ClashToken: a próxima coleta abre 24 horas depois da última (não mais à meia-noite). O horário é mostrado no relógio de Brasília.
alter table core.clash_wallets add column last_claim_at timestamptz;
update core.clash_wallets w set last_claim_at = coalesce((select max(created_at) from core.clash_log l where l.user_id = w.user_id and l.reason = 'daily'), w.updated_at)
 where w.last_claim is not null;

create or replace function public.clash_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare w core.clash_wallets; v_uid uuid := auth.uid(); v_next timestamptz;
begin
  if v_uid is null then raise exception 'login'; end if;
  select * into w from core.clash_wallets where user_id = v_uid;
  v_next := case when w.last_claim_at is null then now() else w.last_claim_at + interval '24 hours' end;
  return jsonb_build_object('balance', coalesce(w.balance, 0),
    'can_claim', exists(select 1 from core.profiles where user_id = v_uid) and now() >= v_next,
    'next_at', v_next, 'last_at', w.last_claim_at);
end $$;

create or replace function public.clash_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); w core.clash_wallets;
begin
  if v_uid is null then raise exception 'login'; end if;
  if not exists(select 1 from core.profiles where user_id = v_uid and status = 'active') then raise exception 'profile_required'; end if;
  insert into core.clash_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from core.clash_wallets where user_id = v_uid for update;
  if w.last_claim_at is not null and now() < w.last_claim_at + interval '24 hours' then
    return jsonb_build_object('ok', false, 'error', 'already', 'balance', w.balance, 'next_at', w.last_claim_at + interval '24 hours');
  end if;
  update core.clash_wallets set balance = balance + 1, last_claim = core.clash_today(), last_claim_at = now(), updated_at = now()
   where user_id = v_uid returning * into w;
  insert into core.clash_log (user_id, delta, reason) values (v_uid, 1, 'daily');
  return jsonb_build_object('ok', true, 'balance', w.balance, 'next_at', w.last_claim_at + interval '24 hours');
end $$;

revoke all on function public.clash_status(), public.clash_claim() from public, anon;
grant execute on function public.clash_status(), public.clash_claim() to authenticated;
