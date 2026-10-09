-- BomberCash · núcleo: identidade, papéis, configurações, ledger imutável, auditoria.
-- Tudo vive no schema `core` (NÃO exposto pela API). O app só enxerga as funções RPC de `public`
-- (migração 0003). Dinheiro só se move por funções `core.*` chamadas pelo servidor (service_role).
-- Convenção do ledger: valores em CENTAVOS inteiros; a soma de todas as linhas de uma transação é zero;
-- o saldo de cada conta é a soma das suas linhas; corrigir = lançar um estorno, nunca editar.

create schema if not exists core;
revoke all on schema core from public;

-- ---------------------------------------------------------------- tipos
create type core.app_role as enum ('player','affiliate','support','finance','compliance','admin','super_admin');
create type core.kyc_status as enum ('pending','approved','rejected');
create type core.user_status as enum ('active','blocked','self_excluded');
create type core.account_kind as enum ('player_wallet','player_escrow','affiliate_payable','withdrawal_hold','house_rake','house_skins','gateway_clearing');
create type core.deposit_status as enum ('pending','paid','expired','cancelled');
create type core.withdrawal_status as enum ('pending_review','approved','sent','failed','rejected');
create type core.match_status as enum ('open','settled','refunded');
create type core.commission_status as enum ('pending','released','paid');

-- ---------------------------------------------------------------- imutabilidade
create function core.forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'tabela imutavel: % em % nao e permitido', tg_op, tg_table_name using errcode = 'insufficient_privilege';
end $$;

-- ---------------------------------------------------------------- perfis (CPF único, maioridade)
create table core.profiles (
  user_id        uuid primary key references auth.users(id) on delete restrict,
  cpf_hash       text not null unique,                       -- HMAC do CPF (segredo fica no servidor); nunca o CPF em claro
  cpf_last4      text not null check (cpf_last4 ~ '^[0-9]{4}$'),
  full_name      text not null check (length(full_name) between 3 and 120),
  birth_date     date not null check (birth_date <= (current_date - interval '18 years')),
  nickname       text not null unique check (nickname ~ '^[A-Za-z0-9_]{3,16}$'),
  kyc            core.kyc_status  not null default 'pending',
  status         core.user_status not null default 'active',
  deposited_cents bigint not null default 0 check (deposited_cents >= 0),
  wagered_cents   bigint not null default 0 check (wagered_cents >= 0),
  first_deposit_at timestamptz,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- papéis e permissões (RBAC por ação)
create table core.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       core.app_role not null,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
create table core.role_permissions (
  role       core.app_role not null,
  permission text not null,
  primary key (role, permission)
);
insert into core.role_permissions (role, permission) values
  ('support','profile.read_masked'),('support','match.read'),('support','dashboard.read'),
  ('finance','withdrawal.review'),('finance','reports.finance'),('finance','dashboard.read'),
  ('compliance','kyc.review'),('compliance','account.block'),('compliance','profile.read_full'),
  ('compliance','audit.read'),('compliance','match.read'),('compliance','dashboard.read'),
  ('admin','settings.request'),('admin','settings.approve'),('admin','affiliate.manage'),
  ('admin','match.read'),('admin','dashboard.read'),
  ('super_admin','settings.approve'),('super_admin','roles.grant'),('super_admin','audit.read'),('super_admin','dashboard.read');

create function core.can(p_user uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from core.user_roles ur join core.role_permissions rp on rp.role = ur.role
    where ur.user_id = p_user and rp.permission = p_perm)
$$;

-- ---------------------------------------------------------------- auditoria (append-only)
create table core.audit_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  actor     uuid,
  action    text not null,
  entity    text,
  entity_id text,
  data      jsonb not null default '{}'
);
create trigger audit_log_immutable before update or delete on core.audit_log for each row execute function core.forbid_mutation();
create trigger audit_log_no_truncate before truncate on core.audit_log for each statement execute function core.forbid_mutation();

create function core.audit(p_actor uuid, p_action text, p_entity text, p_entity_id text, p_data jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into core.audit_log (actor, action, entity, entity_id, data) values (p_actor, p_action, p_entity, p_entity_id, coalesce(p_data,'{}'))
$$;

-- ---------------------------------------------------------------- configurações (mudança exige 2ª pessoa)
create table core.settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into core.settings (key, value) values
  ('rake_bps',                    '2000'),      -- 20% do pote para a casa
  ('affiliate_first_match_bps',   '7000'),      -- 70% do rake da 1ª partida do indicado
  ('commission_hold_hours',       '72'),        -- janela antifraude antes de liberar comissão
  ('min_deposit_cents',           '1000'),
  ('min_bet_cents',               '200'),
  ('allowed_stakes_cents',        '[200,500,1000,2000,5000,10000]'),
  ('min_withdraw_cents',          '1000'),
  ('withdraw_auto_max_cents',     '10000'),     -- até R$ 100 sai sozinho se a conta estiver limpa
  ('withdraw_daily_max_cents',    '100000'),
  ('withdraw_hold_hours',         '24'),        -- carência após o 1º depósito
  ('rollover_bps',                '10000');     -- precisa ter apostado 1x o que depositou antes de sacar

create table core.setting_changes (
  id           bigserial primary key,
  key          text not null references core.settings(key),
  new_value    jsonb not null,
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  approved_by  uuid references auth.users(id),
  approved_at  timestamptz,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  check (approved_by is null or approved_by <> requested_by)       -- quem pede não aprova
);

create function core.setting_int(p_key text) returns bigint
language sql stable security definer set search_path = '' as $$
  select (value #>> '{}')::bigint from core.settings where key = p_key
$$;

-- ---------------------------------------------------------------- ledger de dupla entrada
create table core.accounts (
  id            uuid primary key default gen_random_uuid(),
  kind          core.account_kind not null,
  owner_id      uuid references auth.users(id) on delete restrict,
  balance_cents bigint not null default 0,
  created_at    timestamptz not null default now(),
  check (kind not in ('player_wallet','player_escrow','affiliate_payable') or owner_id is not null),
  check (kind in ('player_wallet','player_escrow','affiliate_payable') or owner_id is null),
  check (kind not in ('player_wallet','player_escrow','affiliate_payable','withdrawal_hold') or balance_cents >= 0)   -- sem saldo negativo para jogador
);
create unique index accounts_owned_uq  on core.accounts (kind, owner_id) where owner_id is not null;
create unique index accounts_global_uq on core.accounts (kind) where owner_id is null;

create table core.txns (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  idem_key   text not null unique,                     -- repetir a mesma chave nunca duplica o lançamento
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table core.ledger_entries (
  id           bigserial primary key,
  txn_id       uuid not null references core.txns(id),
  account_id   uuid not null references core.accounts(id),
  amount_cents bigint not null check (amount_cents <> 0),   -- + credita a conta, - debita
  created_at   timestamptz not null default now()
);
create index ledger_entries_account_idx on core.ledger_entries (account_id, id desc);
create index ledger_entries_txn_idx     on core.ledger_entries (txn_id);

create trigger txns_immutable before update or delete on core.txns for each row execute function core.forbid_mutation();
create trigger txns_no_truncate before truncate on core.txns for each statement execute function core.forbid_mutation();
create trigger entries_immutable before update or delete on core.ledger_entries for each row execute function core.forbid_mutation();
create trigger entries_no_truncate before truncate on core.ledger_entries for each statement execute function core.forbid_mutation();

-- toda transação fecha em zero (checado no fim da transação do banco)
create function core.check_txn_balanced() returns trigger language plpgsql as $$
declare s bigint;
begin
  select coalesce(sum(amount_cents),0) into s from core.ledger_entries where txn_id = new.txn_id;
  if s <> 0 then raise exception 'transacao % nao fecha em zero (soma=%)', new.txn_id, s using errcode = 'check_violation'; end if;
  return null;
end $$;
create constraint trigger entries_balanced after insert on core.ledger_entries
  deferrable initially deferred for each row execute function core.check_txn_balanced();

-- saldo da conta acompanha as linhas (mesma transação)
create function core.apply_entry() returns trigger language plpgsql as $$
begin
  update core.accounts set balance_cents = balance_cents + new.amount_cents where id = new.account_id;
  return new;
end $$;
create trigger entries_apply after insert on core.ledger_entries for each row execute function core.apply_entry();

-- ---------------------------------------------------------------- limites de jogo responsável (tabelas; regras na fase 2)
create table core.rg_limits (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  daily_deposit_cents  bigint check (daily_deposit_cents  >= 0),
  weekly_deposit_cents bigint check (weekly_deposit_cents >= 0),
  monthly_deposit_cents bigint check (monthly_deposit_cents >= 0),
  pending_increase     jsonb,                          -- aumento só vale após 24h; redução vale na hora
  self_excluded_until  timestamptz,
  updated_at           timestamptz not null default now()
);

-- RLS ligado em tudo (sem políticas = ninguém além do dono/service_role lê direto)
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'core' loop
    execute format('alter table core.%I enable row level security', t);
  end loop;
end $$;
