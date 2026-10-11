-- Funções que SÓ o servidor de jogo (service_role) pode chamar. Ficam em public porque o PostgREST só expõe public,
-- mas são revogadas de anon/authenticated: jogador nenhum consegue abrir, liquidar ou reembolsar partida.
create or replace function public.svc_match_open(p_match uuid, p_mode text, p_stake bigint, p_users uuid[])
returns void language sql security definer set search_path = pg_catalog, core as
$$ select core.match_open(p_match, p_mode, p_stake, p_users) $$;

create or replace function public.svc_match_settle(p_match uuid, p_winner uuid, p_seed text, p_result_hash text)
returns jsonb language sql security definer set search_path = pg_catalog, core as
$$ select core.match_settle(p_match, p_winner, p_seed, p_result_hash) $$;

create or replace function public.svc_match_refund(p_match uuid, p_reason text)
returns void language sql security definer set search_path = pg_catalog, core as
$$ select core.match_refund(p_match, p_reason) $$;

revoke all on function public.svc_match_open(uuid, text, bigint, uuid[]) from public, anon, authenticated;
revoke all on function public.svc_match_settle(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.svc_match_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.svc_match_open(uuid, text, bigint, uuid[]) to service_role;
grant execute on function public.svc_match_settle(uuid, uuid, text, text) to service_role;
grant execute on function public.svc_match_refund(uuid, text) to service_role;
