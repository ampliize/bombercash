-- BomberCash · funções que só as Edge Functions (service_role) chamam: cadastro com CPF, depósito PIX,
-- webhook do gateway e pedido de saque. O jogador nunca chama estas funções direto.
create or replace function public.svc_profile_create(p_user uuid, p_cpf_hash text, p_last4 text, p_name text, p_birth date, p_nick text)
returns void language sql security definer set search_path = pg_catalog, core as
$$ select core.profile_create(p_user, p_cpf_hash, p_last4, p_name, p_birth, p_nick) $$;

create or replace function public.svc_deposit_create(p_user uuid, p_amount bigint, p_gateway text, p_ref text, p_qr text, p_expires timestamptz)
returns uuid language sql security definer set search_path = pg_catalog, core as
$$ select core.deposit_create(p_user, p_amount, p_gateway, p_ref, p_qr, p_expires) $$;

create or replace function public.svc_deposit_confirm(p_gateway_ref text, p_paid_cents bigint)
returns uuid language sql security definer set search_path = pg_catalog, core as
$$ select core.deposit_confirm(p_gateway_ref, p_paid_cents) $$;

create or replace function public.svc_webhook_record(p_provider text, p_event text, p_payload jsonb)
returns boolean language sql security definer set search_path = pg_catalog, core as
$$ select core.webhook_record(p_provider, p_event, p_payload) $$;

create or replace function public.svc_withdrawal_request(p_user uuid, p_amount bigint, p_pix_masked text, p_pix_cpf_hash text)
returns jsonb language sql security definer set search_path = pg_catalog, core as
$$ select core.withdrawal_request(p_user, p_amount, p_pix_masked, p_pix_cpf_hash) $$;

revoke all on function public.svc_profile_create(uuid, text, text, text, date, text) from public, anon, authenticated;
revoke all on function public.svc_deposit_create(uuid, bigint, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.svc_deposit_confirm(text, bigint) from public, anon, authenticated;
revoke all on function public.svc_webhook_record(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.svc_withdrawal_request(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.svc_profile_create(uuid, text, text, text, date, text) to service_role;
grant execute on function public.svc_deposit_create(uuid, bigint, text, text, text, timestamptz) to service_role;
grant execute on function public.svc_deposit_confirm(text, bigint) to service_role;
grant execute on function public.svc_webhook_record(text, text, jsonb) to service_role;
grant execute on function public.svc_withdrawal_request(uuid, bigint, text, text) to service_role;

-- leitura do próprio jogador: últimos depósitos e saques (para a tela da carteira)
create or replace function public.my_deposits(p_limit int default 20)
returns table (id uuid, amount_cents bigint, status core.deposit_status, created_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select id, amount_cents, status, created_at, paid_at from core.deposits where user_id = auth.uid()
  order by created_at desc limit least(greatest(p_limit,1),100)
$$;
create or replace function public.my_withdrawals(p_limit int default 20)
returns table (id uuid, amount_cents bigint, status core.withdrawal_status, pix_key_masked text, requested_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select id, amount_cents, status, pix_key_masked, requested_at from core.withdrawals where user_id = auth.uid()
  order by requested_at desc limit least(greatest(p_limit,1),100)
$$;
revoke all on function public.my_deposits(int) from public, anon;
revoke all on function public.my_withdrawals(int) from public, anon;
grant execute on function public.my_deposits(int) to authenticated;
grant execute on function public.my_withdrawals(int) to authenticated;
