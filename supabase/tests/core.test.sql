-- Testes do núcleo financeiro. Rodam como superusuário; as trocas de papel simulam anon/authenticated/service_role.
create schema t;
grant usage on schema t to public;
create function t.ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if c is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'OK    %', msg;
end $$;
-- executa sql como outro papel/usuário e confere se falha com a mensagem esperada ('' = deve funcionar)
create function t.as_run(p_role text, p_sub uuid, p_sql text, p_expect text) returns void language plpgsql as $$
declare m text := ''; failed boolean := false;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text,''), true);
  begin execute p_sql; exception when others then failed := true; m := sqlerrm; end;
  execute 'reset role';
  if p_expect = '' then
    if failed then raise exception 'FALHOU: "%" como % deveria funcionar, mas deu: %', p_sql, p_role, m; end if;
    raise notice 'OK    % pode: %', p_role, left(p_sql, 70);
  else
    if not failed then raise exception 'FALHOU: "%" como % deveria falhar (%)', p_sql, p_role, p_expect; end if;
    if position(p_expect in m) = 0 then raise exception 'FALHOU: erro inesperado em "%": % (esperava %)', p_sql, m, p_expect; end if;
    raise notice 'OK    % bloqueado (%): %', p_role, p_expect, left(p_sql, 60);
  end if;
end $$;
create function t.throws(p_sql text, p_expect text) returns void language plpgsql as $$
declare m text := ''; failed boolean := false;
begin
  begin execute p_sql; exception when others then failed := true; m := sqlerrm; end;
  if not failed then raise exception 'FALHOU: deveria falhar (%): %', p_expect, p_sql; end if;
  if position(p_expect in m) = 0 then raise exception 'FALHOU: erro inesperado: % (esperava %) em %', m, p_expect, p_sql; end if;
  raise notice 'OK    falha como esperado (%): %', p_expect, left(p_sql, 70);
end $$;
create function t.bal(p_kind core.account_kind, p_owner uuid default null) returns bigint language sql stable as $$
  select coalesce((select balance_cents from core.accounts where kind = p_kind and owner_id is not distinct from p_owner), 0)
$$;
create function t.zero_sum() returns boolean language sql stable as $$ select coalesce(sum(balance_cents),0) = 0 from core.accounts $$;

-- ---------- elenco
create table t.u (name text primary key, id uuid not null default gen_random_uuid());
insert into t.u(name) values ('p1'),('p2'),('p3'),('p4'),('p5'),('w1'),('r1'),('r2'),('af1'),('adm1'),('adm2'),('fin1'),('comp1'),('sup1'),('super1');
insert into auth.users (id, email) select id, name || '@t.local' from t.u;
create function t.id(n text) returns uuid language sql stable as $$ select id from t.u where name = n $$;

do $do$
declare n text; i int := 0;
begin
  for n in select name from t.u where name not in ('adm1','adm2','fin1','comp1','sup1','super1') order by name loop
    i := i + 1;
    perform core.profile_create(t.id(n), 'cpfhash-' || n, lpad(i::text, 4, '0'), 'Jogador ' || n, date '1990-01-01', 'nick_' || n);
    update core.profiles set kyc = 'approved', created_at = now() - interval '10 days' where user_id = t.id(n);
  end loop;
  -- equipe (bootstrap por superusuário; em produção o primeiro super_admin é criado por migração/console)
  for n in select name from t.u where name in ('adm1','adm2','fin1','comp1','sup1','super1') loop
    perform core.profile_create(t.id(n), 'cpfhash-' || n, '9999', 'Equipe ' || n, date '1985-05-05', 'nick_' || n);
  end loop;
  insert into core.user_roles (user_id, role) values (t.id('adm1'),'admin'),(t.id('adm2'),'admin'),(t.id('fin1'),'finance'),(t.id('comp1'),'compliance'),(t.id('sup1'),'support'),(t.id('super1'),'super_admin');
  perform t.ok(true, 'elenco criado (jogadores, afiliado e equipe com papeis)');
end $do$;

-- ---------- identidade
select t.throws($$ insert into core.profiles (user_id, cpf_hash, cpf_last4, full_name, birth_date, nickname) values (gen_random_uuid(), 'x', '1111', 'Menor', current_date - interval '17 years', 'menor1') $$, 'birth_date');
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000aa');
select t.throws($$ select core.profile_create('00000000-0000-0000-0000-0000000000aa', 'h-menor', '1234', 'Menor de idade', (current_date - interval '17 years')::date, 'menor_ok') $$, 'birth_date');
select t.throws($$ select core.profile_create('00000000-0000-0000-0000-0000000000aa', 'cpfhash-p1', '1234', 'CPF repetido', date '1990-01-01', 'cpf_dup') $$, 'cpf_hash');
select t.ok(not exists (select 1 from core.profiles where user_id = '00000000-0000-0000-0000-0000000000aa'), 'menor de 18 e CPF repetido nao entram (uma conta por CPF)');

-- ---------- depósito PIX
select t.throws($$ select core.deposit_create(t.id('p1'), 500, 'pix', 'ref-low', 'qr', now() + interval '1 hour') $$, 'below_min_deposit');
do $do$
declare d uuid;
begin
  d := core.deposit_create(t.id('p1'), 5000, 'pix', 'ref-1', 'qr', now() + interval '1 hour');
  perform t.ok(t.bal('player_wallet', t.id('p1')) = 0, 'depositos pendentes nao creditam');
  perform t.throws($$ select core.deposit_confirm('ref-1', 4999) $$, 'amount_mismatch');
  perform core.deposit_confirm('ref-1', 5000);
  perform t.ok(t.bal('player_wallet', t.id('p1')) = 5000, 'webhook pago credita R$ 50,00');
  perform core.deposit_confirm('ref-1', 5000);
  perform t.ok(t.bal('player_wallet', t.id('p1')) = 5000, 'webhook repetido nao credita de novo (idempotente)');
  perform t.ok(core.webhook_record('pix', 'evt-1', '{}') and not core.webhook_record('pix', 'evt-1', '{}'), 'evento de webhook repetido e detectado');
  perform t.ok(t.bal('gateway_clearing') = -5000 and t.zero_sum(), 'caixa no gateway = R$ 50,00 e soma de todas as contas = 0');
end $do$;
do $do$ begin
  perform core.deposit_create(t.id(n), 2000, 'pix', 'ref-' || n, 'qr', now() + interval '1 hour') from (values ('p2'),('p3'),('p4'),('p5'),('w1'),('r1'),('r2')) v(n);
  perform core.deposit_confirm('ref-' || n, 2000) from (values ('p2'),('p3'),('p4'),('p5'),('w1'),('r1'),('r2')) v(n);
  perform t.ok(t.zero_sum(), 'varios depositos: soma continua zero');
end $do$;

-- ---------- ledger imutável
select t.throws($$ update core.ledger_entries set amount_cents = 1 where id = 1 $$, 'imutavel');
select t.throws($$ delete from core.ledger_entries $$, 'imutavel');
select t.throws($$ truncate core.ledger_entries $$, 'imutavel');
select t.throws($$ update core.txns set kind = 'x' $$, 'imutavel');
select t.throws($$ update core.audit_log set action = 'x' $$, 'imutavel');
select t.throws($$ select core.post_txn('x','bad-1', jsonb_build_array(jsonb_build_object('account', core.account_of('house_rake'), 'amount', 100), jsonb_build_object('account', core.account_of('house_skins'), 'amount', -50))) $$, 'nao fecha em zero');
select t.throws($$ update core.accounts set balance_cents = -1 where kind = 'player_wallet' and owner_id = t.id('p1') $$, 'check');

-- ---------- partida 1x1: escrow, rake 20%, vencedor leva o resto
do $do$
declare m uuid := gen_random_uuid(); r jsonb;
begin
  perform core.match_open(m, '1x1', 1000, array[t.id('p2'), t.id('p3')]);
  perform t.ok(t.bal('player_wallet', t.id('p2')) = 1000 and t.bal('player_escrow', t.id('p2')) = 1000, 'entrada de R$ 10 vai da carteira para o escrow');
  perform t.throws(format($q$ select core.match_open(%L, '1x1', 1000, array[%L::uuid, %L::uuid]) $q$, gen_random_uuid(), t.id('p2'), t.id('p4')), 'already_in_match');
  r := core.match_settle(m, t.id('p2'), 'seed-1', 'hash-1');
  perform t.ok((r->>'pot')::bigint = 2000 and (r->>'rake')::bigint = 400 and (r->>'prize')::bigint = 1600, 'pote R$ 20: casa fica com 20% (R$ 4), vencedor leva R$ 16');
  perform t.ok(t.bal('player_wallet', t.id('p2')) = 2600 and t.bal('player_wallet', t.id('p3')) = 1000, 'carteiras: vencedor 10+16, perdedor 10');
  perform t.ok(t.bal('player_escrow', t.id('p2')) = 0 and t.bal('player_escrow', t.id('p3')) = 0 and t.bal('house_rake') = 400, 'escrow zerado e rake = R$ 4');
  r := core.match_settle(m, t.id('p3'), 'seed-x', 'hash-x');
  perform t.ok((r->>'idempotent')::boolean and t.bal('player_wallet', t.id('p2')) = 2600, 'liquidar de novo e no-op (nao paga duas vezes)');
  perform t.throws(format($q$ select core.match_refund(%L, 'x') $q$, m), 'match_not_open');
  perform t.ok((select wagered_cents from core.profiles where user_id = t.id('p2')) = 1000, 'valor apostado entra no rollover');
  perform t.ok(t.zero_sum(), 'soma de todas as contas = 0 apos a partida');
end $do$;

-- ---------- erros de partida: saldo, aposta, atomicidade
do $do$
declare m uuid := gen_random_uuid(); before_p4 bigint := t.bal('player_wallet', t.id('p4'));
begin
  perform t.throws(format($q$ select core.match_open(%L, '1x1', 10000, array[%L::uuid, %L::uuid]) $q$, m, t.id('p4'), t.id('p5')), 'insufficient_funds');
  perform t.ok(not exists (select 1 from core.matches where id = m) and t.bal('player_wallet', t.id('p4')) = before_p4, 'saldo insuficiente aborta tudo (sem partida e sem escrow parcial)');
  perform t.throws(format($q$ select core.match_open(%L, '1x1', 300, array[%L::uuid, %L::uuid]) $q$, gen_random_uuid(), t.id('p4'), t.id('p5')), 'stake_not_allowed');
  update core.profiles set status = 'blocked' where user_id = t.id('p5');
  perform t.throws(format($q$ select core.match_open(%L, '1x1', 500, array[%L::uuid, %L::uuid]) $q$, gen_random_uuid(), t.id('p4'), t.id('p5')), 'player_not_eligible');
  update core.profiles set status = 'active' where user_id = t.id('p5');
end $do$;

-- ---------- mata-mata com 3 humanos (pote = aposta x humanos)
do $do$
declare m uuid := gen_random_uuid(); r jsonb;
begin
  perform core.match_open(m, '4x4', 500, array[t.id('p3'), t.id('p4'), t.id('p5')]);
  r := core.match_settle(m, t.id('p4'), 's', 'h');
  perform t.ok((r->>'pot')::bigint = 1500 and (r->>'rake')::bigint = 300 and (r->>'prize')::bigint = 1200, '3 humanos x R$ 5: pote R$ 15, rake R$ 3, vencedor R$ 12');
  perform t.ok(t.zero_sum(), 'soma = 0');
end $do$;

-- ---------- reembolso (empate / falha nossa)
do $do$
declare m uuid := gen_random_uuid(); w2 bigint := t.bal('player_wallet', t.id('p3')); w3 bigint := t.bal('player_wallet', t.id('p4'));
begin
  perform core.match_open(m, '1x1', 500, array[t.id('p3'), t.id('p4')]);
  perform core.match_refund(m, 'falha_servidor');
  perform t.ok(t.bal('player_wallet', t.id('p3')) = w2 and t.bal('player_wallet', t.id('p4')) = w3 and t.bal('player_escrow', t.id('p3')) = 0, 'reembolso devolve a entrada integral, sem rake');
  perform core.match_refund(m, 'de novo');
  perform t.ok(t.bal('player_wallet', t.id('p3')) = w2, 'reembolso repetido e no-op');
end $do$;

-- ---------- afiliado: 70% do rake da 1ª partida do indicado
select core.role_grant(t.id('super1'), t.id('af1'), 'support');   -- só para testar a concessão
select t.throws($$ select core.affiliate_create(t.id('sup1'), t.id('af1'), 'AFI001') $$, 'forbidden');
select core.affiliate_create(t.id('adm1'), t.id('af1'), 'AFI001');
do $do$
declare m uuid := gen_random_uuid(); r jsonb; m2 uuid := gen_random_uuid(); paid bigint;
begin
  perform t.ok(not core.referral_register(t.id('af1'), 'AFI001'), 'afiliado nao pode se indicar');
  perform t.ok(core.referral_register(t.id('r1'), 'afi001'), 'indicacao registrada (codigo sem diferenciar maiuscula)');
  perform core.match_open(m, '1x1', 1000, array[t.id('r1'), t.id('r2')]);
  r := core.match_settle(m, t.id('r2'), 's', 'h');
  perform t.ok(t.bal('affiliate_payable', t.id('af1')) = 140, '1a partida do indicado: rake R$ 4 -> parte dele R$ 2 -> 70% = R$ 1,40 para o afiliado');
  perform t.ok(t.bal('house_rake') = 400 + 300 + 260, 'rake da casa fica com o restante (R$ 2,60 nesta partida)');
  perform t.ok((select first_match_done from core.referrals where referred_id = t.id('r1')), '1a partida marcada');
  perform core.match_open(m2, '1x1', 500, array[t.id('r1'), t.id('r2')]);
  perform core.match_settle(m2, t.id('r1'), 's', 'h');
  perform t.ok(t.bal('affiliate_payable', t.id('af1')) = 140, '2a partida do indicado nao gera comissao');
  perform t.ok(not core.referral_register(t.id('r2'), 'AFI001'), 'quem ja jogou nao pode ser indicado depois');
  perform t.ok(core.commission_release_due() = 0, 'comissao nova ainda esta na janela antifraude de 72h');
  update core.affiliate_commissions set release_at = now() - interval '1 minute';
  perform t.ok(core.commission_release_due() = 1, 'apos a janela a comissao e liberada');
  paid := core.commission_payout(t.id('af1'));
  perform t.ok(paid = 140 and t.bal('player_wallet', t.id('af1')) = 140 and t.bal('affiliate_payable', t.id('af1')) = 0, 'pagamento leva a comissao para a carteira do afiliado');
  paid := core.commission_payout(t.id('af1'));
  perform t.ok(paid = 0 and t.bal('player_wallet', t.id('af1')) = 140, 'pagar de novo nao duplica');
  perform t.ok(t.zero_sum(), 'soma = 0');
end $do$;

-- ---------- saque PIX
do $do$
declare r jsonb; id1 uuid; wal bigint;
begin
  -- w1: depositou 20, ainda dentro da carência de 24h
  perform t.throws($$ select core.withdrawal_request(t.id('w1'), 1000, '***.123', 'cpfhash-w1') $$, 'withdraw_hold');
  update core.profiles set first_deposit_at = now() - interval '2 days' where user_id = t.id('w1');
  perform t.throws($$ select core.withdrawal_request(t.id('w1'), 1000, '***.123', 'cpfhash-w1') $$, 'rollover_not_met');
  update core.profiles set wagered_cents = 2000 where user_id = t.id('w1');
  perform t.throws($$ select core.withdrawal_request(t.id('w1'), 1000, '***.123', 'cpfhash-OUTRA-PESSOA') $$, 'pix_owner_mismatch');
  perform t.throws($$ select core.withdrawal_request(t.id('w1'), 500, '***.123', 'cpfhash-w1') $$, 'below_min_withdraw');
  perform t.throws($$ select core.withdrawal_request(t.id('w1'), 50000, '***.123', 'cpfhash-w1') $$, 'insufficient_funds');
  perform t.throws($q$ select core.withdrawal_request(t.id('w1'), 999999, '***.123', 'cpfhash-w1') $q$, 'daily_limit');
  update core.profiles set kyc = 'pending' where user_id = t.id('w1');
  perform t.throws($$ select core.withdrawal_request(t.id('w1'), 1000, '***.123', 'cpfhash-w1') $$, 'kyc_required');
  update core.profiles set kyc = 'approved' where user_id = t.id('w1');

  r := core.withdrawal_request(t.id('w1'), 1000, '***.123', 'cpfhash-w1');
  perform t.ok(r->>'status' = 'approved' and t.bal('player_wallet', t.id('w1')) = 1000 and t.bal('withdrawal_hold') = 1000, 'saque pequeno de conta limpa sai automatico; valor fica retido');
  id1 := (r->>'id')::uuid;
  perform core.withdrawal_mark_sent(id1, 'gw-1');
  perform core.withdrawal_mark_sent(id1, 'gw-1');
  perform t.ok(t.bal('withdrawal_hold') = 0 and (select status from core.withdrawals where id = id1) = 'sent', 'enviado: retencao liquidada (e repetir nao duplica)');

  -- conta nova cai em revisão manual; reprovar devolve
  update core.profiles set created_at = now() - interval '1 hour' where user_id = t.id('w1');
  r := core.withdrawal_request(t.id('w1'), 1000, '***.123', 'cpfhash-w1');
  perform t.ok(r->>'status' = 'pending_review' and r->'flags' ? 'new_account', 'conta com menos de 72h vai para revisao manual');
  id1 := (r->>'id')::uuid; wal := t.bal('player_wallet', t.id('w1'));
  perform t.throws(format($q$ select core.withdrawal_review(%L, %L, true) $q$, t.id('sup1'), id1), 'forbidden');
  perform t.throws(format($q$ select core.withdrawal_review(%L, %L, true) $q$, t.id('adm1'), id1), 'forbidden');
  perform core.withdrawal_review(t.id('fin1'), id1, false, 'suspeita');
  perform t.ok(t.bal('player_wallet', t.id('w1')) = wal + 1000 and (select status from core.withdrawals where id = id1) = 'rejected', 'reprovado: dinheiro volta para a carteira');
  perform t.throws(format($q$ select core.withdrawal_review(%L, %L, true) $q$, t.id('fin1'), id1), 'not_pending_review');

  r := core.withdrawal_request(t.id('w1'), 1000, '***.123', 'cpfhash-w1'); id1 := (r->>'id')::uuid;
  perform core.withdrawal_review(t.id('fin1'), id1, true, 'ok');
  perform core.withdrawal_mark_failed(id1, 'gateway recusou');
  perform t.ok((select status from core.withdrawals where id = id1) = 'failed' and t.bal('withdrawal_hold') = 0, 'falha no gateway devolve o saldo');
  perform t.ok(t.zero_sum(), 'soma = 0 apos os saques');

end $do$;

-- ---------- configurações com aprovação dupla
do $do$
declare c bigint; m uuid := gen_random_uuid(); r jsonb;
begin
  perform t.throws($$ select core.setting_request(t.id('fin1'), 'rake_bps', '1500') $$, 'forbidden');
  perform t.throws($$ select core.setting_request(t.id('adm1'), 'rake_bps', '20000') $$, 'invalid_value');
  perform t.throws($$ select core.setting_request(t.id('adm1'), 'nao_existe', '1') $$, 'unknown_setting');
  c := core.setting_request(t.id('adm1'), 'rake_bps', '1500');
  perform t.ok(core.setting_int('rake_bps') = 2000, 'pedido pendente nao muda o rake');
  perform t.throws(format($q$ select core.setting_approve(%L, %s) $q$, t.id('adm1'), c), 'cannot_approve_own_change');
  perform t.throws(format($q$ select core.setting_approve(%L, %s) $q$, t.id('fin1'), c), 'forbidden');
  perform core.setting_approve(t.id('adm2'), c);
  perform t.ok(core.setting_int('rake_bps') = 1500, 'segunda pessoa aprova: rake vai para 15%');
  perform core.deposit_create(t.id('p2'), 2000, 'pix', 'ref-p2b', 'qr', now() + interval '1 hour'); perform core.deposit_confirm('ref-p2b', 2000);
  perform core.match_open(m, '1x1', 500, array[t.id('p2'), t.id('p3')]);
  r := core.match_settle(m, t.id('p2'), 's', 'h');
  perform t.ok((r->>'rake')::bigint = 150 and (r->>'prize')::bigint = 850, 'nova partida usa 15%: pote R$ 10, rake R$ 1,50, vencedor R$ 8,50');
  perform t.ok((select count(*) from core.audit_log where action in ('setting.request','setting.approve')) = 2, 'pedido e aprovacao ficam na auditoria');
end $do$;

-- ---------- papéis
select t.throws($$ select core.role_grant(t.id('adm1'), t.id('p1'), 'finance') $$, 'forbidden');
select t.throws($$ select core.role_grant(t.id('super1'), t.id('super1'), 'admin') $$, 'cannot_grant_to_self');
select core.role_grant(t.id('super1'), t.id('p1'), 'support');
select t.ok(core.can(t.id('p1'), 'dashboard.read'), 'papel concedido vale na hora');
select core.role_revoke(t.id('super1'), t.id('p1'), 'support');
select t.ok(not core.can(t.id('p1'), 'dashboard.read'), 'papel revogado deixa de valer');

-- ---------- permissões de verdade (papéis do banco)
select t.as_run('anon', null, 'select * from public.my_wallet()', 'permission denied');
select t.as_run('anon', null, 'select core.deposit_confirm(''x'', 1)', 'permission denied');
select t.as_run('authenticated', t.id('p2'), 'select * from public.my_wallet()', '');
select t.as_run('authenticated', t.id('p2'), 'select * from public.my_ledger(5)', '');
select t.as_run('authenticated', t.id('p2'), 'select * from core.profiles', 'permission denied');
select t.as_run('authenticated', t.id('p2'), 'select * from core.ledger_entries', 'permission denied');
select t.as_run('authenticated', t.id('p2'), 'select core.deposit_confirm(''ref-1'', 5000)', 'permission denied');
select t.as_run('authenticated', t.id('p2'), 'select core.match_settle(gen_random_uuid(), gen_random_uuid(), ''s'', ''h'')', 'permission denied');
select t.as_run('authenticated', t.id('p2'), 'select core.post_txn(''x'',''y'',''[]'')', 'permission denied');
select t.as_run('authenticated', t.id('p2'), 'select public.admin_dashboard()', 'forbidden');
select t.as_run('authenticated', t.id('p2'), 'select * from public.admin_pending_withdrawals()', 'forbidden');
select t.as_run('authenticated', t.id('sup1'), 'select public.admin_dashboard()', '');
select t.as_run('authenticated', t.id('fin1'), 'select * from public.admin_pending_withdrawals()', '');
select t.as_run('authenticated', t.id('adm1'), 'select public.admin_setting_request(''min_bet_cents'', ''200'')', '');
select t.as_run('service_role', null, 'select core.post_txn(''x'',''y'',''[]'')', 'permission denied');

-- a carteira devolvida e a do proprio usuario logado
select set_config('request.jwt.claim.sub', t.id('p2')::text, false);
select t.ok((select balance_cents from public.my_wallet()) = t.bal('player_wallet', t.id('p2')), 'my_wallet() devolve a carteira do proprio usuario');
select t.ok((select count(*) from public.my_ledger(100)) > 0 and (select count(*) from public.my_ledger(100)) = (select count(*) from core.ledger_entries le join core.accounts a on a.id = le.account_id where a.kind = 'player_wallet' and a.owner_id = t.id('p2')), 'my_ledger() lista so lancamentos da propria carteira');
select set_config('request.jwt.claim.sub', t.id('sup1')::text, false);
select t.ok((public.admin_dashboard()->>'players')::int > 0, 'painel calcula para quem tem permissao');
select set_config('request.jwt.claim.sub', '', false);

select t.ok(t.zero_sum(), 'FINAL: soma de todas as contas do ledger = 0');
select t.ok((select count(*) from core.audit_log) > 5, 'FINAL: auditoria registrou as acoes sensiveis');
