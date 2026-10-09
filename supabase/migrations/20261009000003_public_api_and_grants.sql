-- BomberCash · API exposta ao app (schema public) + permissões.
-- Regra de ouro: o cliente (anon/authenticated) NUNCA move dinheiro. Ele só lê o que é dele e,
-- no painel, executa ações que passam por checagem de papel (core.can). Quem move dinheiro é o servidor (service_role).

-- ---------------------------------------------------------------- leitura do jogador
create function public.my_profile() returns table (nickname text, kyc core.kyc_status, status core.user_status, cpf_last4 text)
language sql stable security definer set search_path = '' as $$
  select nickname, kyc, status, cpf_last4 from core.profiles where user_id = auth.uid()
$$;

create function public.my_wallet() returns table (balance_cents bigint, escrow_cents bigint)
language sql stable security definer set search_path = '' as $$
  select coalesce((select balance_cents from core.accounts where kind = 'player_wallet' and owner_id = auth.uid()), 0),
         coalesce((select balance_cents from core.accounts where kind = 'player_escrow' and owner_id = auth.uid()), 0)
$$;

create function public.my_ledger(p_limit int default 50) returns table (at timestamptz, kind text, amount_cents bigint)
language sql stable security definer set search_path = '' as $$
  select le.created_at, t.kind, le.amount_cents
    from core.ledger_entries le
    join core.accounts a on a.id = le.account_id and a.kind = 'player_wallet' and a.owner_id = auth.uid()
    join core.txns t on t.id = le.txn_id
   order by le.id desc limit least(greatest(p_limit,1), 200)
$$;

create function public.my_roles() returns setof core.app_role
language sql stable security definer set search_path = '' as $$
  select role from core.user_roles where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------- painel (cada ação confere o papel)
create function public.admin_pending_withdrawals() returns table (id uuid, user_id uuid, amount_cents bigint, flags jsonb, requested_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.require_can(auth.uid(), 'withdrawal.review');
  return query select w.id, w.user_id, w.amount_cents, w.flags, w.requested_at from core.withdrawals w where w.status = 'pending_review' order by w.requested_at;
end $$;

create function public.admin_review_withdrawal(p_id uuid, p_approve boolean, p_note text default null) returns core.withdrawal_status
language sql security definer set search_path = '' as $$
  select core.withdrawal_review(auth.uid(), p_id, p_approve, p_note)
$$;

create function public.admin_setting_request(p_key text, p_value jsonb) returns bigint
language sql security definer set search_path = '' as $$
  select core.setting_request(auth.uid(), p_key, p_value)
$$;

create function public.admin_setting_approve(p_change bigint) returns void
language sql security definer set search_path = '' as $$
  select core.setting_approve(auth.uid(), p_change)
$$;

create function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.require_can(auth.uid(), 'dashboard.read');
  return jsonb_build_object(
    'deposits_today_cents',  (select coalesce(sum(amount_cents),0) from core.deposits where status = 'paid' and paid_at >= date_trunc('day', now())),
    'withdrawals_pending',   (select count(*) from core.withdrawals where status = 'pending_review'),
    'withdrawals_today_cents',(select coalesce(sum(amount_cents),0) from core.withdrawals where status in ('approved','sent') and requested_at >= date_trunc('day', now())),
    'matches_open',          (select count(*) from core.matches where status = 'open'),
    'matches_today',         (select count(*) from core.matches where opened_at >= date_trunc('day', now())),
    'rake_total_cents',      (select coalesce(balance_cents,0) from core.accounts where kind = 'house_rake'),
    'players',               (select count(*) from core.profiles));
end $$;

-- ---------------------------------------------------------------- permissões
-- 1) ninguém herda nada por padrão
revoke all on all tables    in schema core from public, anon, authenticated;
revoke all on all sequences in schema core from public, anon, authenticated;
revoke all on all functions in schema core from public, anon, authenticated;
revoke usage on schema core from public, anon, authenticated;

-- 2) servidor (service_role) usa as funções core.*
grant usage on schema core to service_role;
grant execute on all functions in schema core to service_role;
revoke execute on function core.post_txn(text, text, jsonb, jsonb) from service_role;   -- lançamento cru só por dentro das funções de negócio

-- 3) API pública: só usuário logado
revoke execute on function public.my_profile(), public.my_wallet(), public.my_ledger(int), public.my_roles(),
  public.admin_pending_withdrawals(), public.admin_review_withdrawal(uuid, boolean, text),
  public.admin_setting_request(text, jsonb), public.admin_setting_approve(bigint), public.admin_dashboard()
  from public, anon;
grant execute on function public.my_profile(), public.my_wallet(), public.my_ledger(int), public.my_roles(),
  public.admin_pending_withdrawals(), public.admin_review_withdrawal(uuid, boolean, text),
  public.admin_setting_request(text, jsonb), public.admin_setting_approve(bigint), public.admin_dashboard()
  to authenticated;
