-- BomberCash · Parte D: configurações com aprovação dupla e papéis (revogar = marcar revoked_at, sem apagar histórico).
alter table core.user_roles add column revoked_at timestamptz;

create or replace function core.can(p_user uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from core.user_roles ur join core.role_permissions rp on rp.role = ur.role
    where ur.user_id = p_user and ur.revoked_at is null and rp.permission = p_perm)
$$;

create or replace function core.affiliate_create(p_actor uuid, p_user uuid, p_code text, p_bps int default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_can(p_actor, 'affiliate.manage');
  insert into core.affiliates (user_id, code, commission_bps) values (p_user, p_code, p_bps);
  insert into core.user_roles (user_id, role, granted_by) values (p_user, 'affiliate', p_actor)
    on conflict (user_id, role) do update set revoked_at = null, granted_by = excluded.granted_by, granted_at = now();
  perform core.audit(p_actor, 'affiliate.create', 'affiliate', p_user::text, jsonb_build_object('code', p_code, 'bps', p_bps));
end $$;

-- ---------------------------------------------------------------- configurações com aprovação dupla e papéis
create function core.setting_request(p_actor uuid, p_key text, p_value jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform core.require_can(p_actor, 'settings.request');
  if not exists (select 1 from core.settings where key = p_key) then raise exception 'unknown_setting'; end if;
  if right(p_key, 4) = '_bps' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 0 and 10000) then raise exception 'invalid_value'; end if;
  insert into core.setting_changes (key, new_value, requested_by) values (p_key, p_value, p_actor) returning id into v_id;
  perform core.audit(p_actor, 'setting.request', 'setting', p_key, jsonb_build_object('value', p_value, 'change', v_id));
  return v_id;
end $$;

create function core.setting_approve(p_actor uuid, p_change bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare c core.setting_changes;
begin
  perform core.require_can(p_actor, 'settings.approve');
  select * into c from core.setting_changes where id = p_change for update;
  if not found then raise exception 'change_not_found'; end if;
  if c.status <> 'pending' then raise exception 'change_not_pending'; end if;
  if c.requested_by = p_actor then raise exception 'cannot_approve_own_change'; end if;
  update core.setting_changes set status = 'approved', approved_by = p_actor, approved_at = now() where id = p_change;
  update core.settings set value = c.new_value, updated_by = p_actor, updated_at = now() where key = c.key;   -- vale só para partidas futuras
  perform core.audit(p_actor, 'setting.approve', 'setting', c.key, jsonb_build_object('value', c.new_value, 'change', p_change));
end $$;

create function core.role_grant(p_actor uuid, p_user uuid, p_role core.app_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_can(p_actor, 'roles.grant');
  if p_actor = p_user then raise exception 'cannot_grant_to_self'; end if;
  insert into core.user_roles (user_id, role, granted_by) values (p_user, p_role, p_actor)
    on conflict (user_id, role) do update set revoked_at = null, granted_by = excluded.granted_by, granted_at = now();
  perform core.audit(p_actor, 'role.grant', 'user', p_user::text, jsonb_build_object('role', p_role));
end $$;

create function core.role_revoke(p_actor uuid, p_user uuid, p_role core.app_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_can(p_actor, 'roles.grant');
  update core.user_roles set revoked_at = now() where user_id = p_user and role = p_role and revoked_at is null;
  perform core.audit(p_actor, 'role.revoke', 'user', p_user::text, jsonb_build_object('role', p_role));
end $$;

