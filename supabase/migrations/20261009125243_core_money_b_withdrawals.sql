-- BomberCash · Parte B: saques PIX (híbrido, carência, rollover, titularidade do CPF).

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

alter table core.withdrawals enable row level security;
