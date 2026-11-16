begin;

alter table public.employees
  add column if not exists is_co_owner boolean not null default false;

alter table public.employees
  drop constraint if exists employees_owner_roles_exclusive;

alter table public.employees
  add constraint employees_owner_roles_exclusive
  check (not (is_owner and is_co_owner));

alter table public.stores
  add column if not exists icon_url text;

create or replace function public.is_store_owner(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select p_store_id is not null and exists (
    select 1
    from public.employees e
    where e.store_id = p_store_id
      and e.auth_user_id = auth.uid()
      and (e.is_owner or e.is_co_owner)
      and e.status = 'active'
      and coalesce((auth.jwt() ->> 'iat')::bigint, 0) >= extract(epoch from e.pin_updated_at)::bigint
  );
$$;

create or replace function public.employee_can(
  p_actor_id uuid,
  p_actor_token text,
  p_permission text
) returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.employees e
    where e.id = p_actor_id
      and e.auth_user_id = auth.uid()
      and e.status = 'active'
      and coalesce((auth.jwt() ->> 'iat')::bigint, 0) >= extract(epoch from e.pin_updated_at)::bigint
      and (
        ((e.is_owner or e.is_co_owner)
          and p_permission in ('edit_catalog', 'add_products', 'cancel_sale', 'manage_employees'))
        or (p_permission = 'edit_catalog' and e.can_edit_catalog)
        or (p_permission = 'add_products' and e.can_add_products)
      )
  );
$$;

create or replace function public.guard_employee_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor public.employees%rowtype;
begin
  if auth.role() = 'service_role' or auth.role() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if auth.role() <> 'authenticated' then
    raise exception 'Authentification requise';
  end if;

  select * into v_actor
  from public.employees e
  where e.auth_user_id = auth.uid()
    and e.status = 'active'
    and (e.is_owner or e.is_co_owner)
  limit 1;

  if not found then
    raise exception 'Action reservee au gerant';
  end if;

  if tg_op = 'INSERT' then
    if new.is_owner then
      raise exception 'Creation de gerant non autorisee';
    end if;
    new.store_id := v_actor.store_id;
  elsif old.store_id <> v_actor.store_id
     or old.is_owner
     or new.store_id <> old.store_id
     or new.is_owner <> old.is_owner then
    raise exception 'Employe d''une autre boutique';
  end if;

  return new;
end;
$$;

drop function if exists public.create_employee(uuid, text, text, text, boolean, boolean);
create function public.create_employee(
  p_actor_id uuid,
  p_actor_token text,
  p_name text,
  p_phone text default null,
  p_can_edit boolean default false,
  p_can_add boolean default false,
  p_is_co_owner boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_emp public.employees%rowtype;
begin
  if not public.employee_can(p_actor_id, p_actor_token, 'manage_employees') then
    return jsonb_build_object('ok', false, 'error', 'Action reservee au gerant');
  end if;
  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('ok', false, 'error', 'Le nom de l''employe est obligatoire');
  end if;

  insert into public.employees (
    store_id, name, phone, status, can_edit_catalog, can_add_products, is_co_owner
  )
  values (
    public.current_store_id(), btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''),
    'invited', coalesce(p_can_edit, false), coalesce(p_can_add, false),
    coalesce(p_is_co_owner, false)
  )
  returning * into v_emp;

  return jsonb_build_object(
    'ok', true,
    'employee', jsonb_build_object(
      'id', v_emp.id, 'name', v_emp.name, 'phone', v_emp.phone,
      'status', v_emp.status, 'can_edit_catalog', v_emp.can_edit_catalog,
      'can_add_products', v_emp.can_add_products, 'is_co_owner', v_emp.is_co_owner,
      'access_token', v_emp.access_token, 'created_at', v_emp.created_at
    )
  );
end;
$$;

drop function if exists public.update_employee(uuid, text, uuid, text, boolean, boolean);
create function public.update_employee(
  p_actor_id uuid,
  p_actor_token text,
  p_employee_id uuid,
  p_status text default null,
  p_can_edit boolean default null,
  p_can_add boolean default null,
  p_is_co_owner boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_emp public.employees%rowtype;
begin
  if not public.employee_can(p_actor_id, p_actor_token, 'manage_employees') then
    return jsonb_build_object('ok', false, 'error', 'Action reservee au gerant');
  end if;

  select * into v_emp
  from public.employees
  where id = p_employee_id
    and store_id = public.current_store_id()
    and is_owner = false
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Employe introuvable');
  end if;
  if p_status is not null and p_status not in ('invited', 'active', 'suspended') then
    return jsonb_build_object('ok', false, 'error', 'Statut invalide');
  end if;

  update public.employees
  set status = coalesce(p_status, v_emp.status),
      can_edit_catalog = coalesce(p_can_edit, v_emp.can_edit_catalog),
      can_add_products = coalesce(p_can_add, v_emp.can_add_products),
      is_co_owner = coalesce(p_is_co_owner, v_emp.is_co_owner),
      updated_at = now()
  where id = p_employee_id
  returning * into v_emp;

  return jsonb_build_object(
    'ok', true,
    'employee', jsonb_build_object(
      'id', v_emp.id, 'name', v_emp.name, 'phone', v_emp.phone,
      'status', v_emp.status, 'can_edit_catalog', v_emp.can_edit_catalog,
      'can_add_products', v_emp.can_add_products, 'is_co_owner', v_emp.is_co_owner,
      'access_token', v_emp.access_token, 'created_at', v_emp.created_at
    )
  );
end;
$$;

grant execute on function public.create_employee(uuid, text, text, text, boolean, boolean, boolean)
  to anon, authenticated;
grant execute on function public.update_employee(uuid, text, uuid, text, boolean, boolean, boolean)
  to anon, authenticated;

create or replace function public.list_employees(
  p_actor_id uuid,
  p_actor_token text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_rows jsonb;
begin
  if not public.employee_can(p_actor_id, p_actor_token, 'manage_employees') then
    return jsonb_build_object('ok', false, 'error', 'Action reservee au gerant');
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at), '[]'::jsonb)
    into v_rows
  from (
    select id, name, phone, status, can_edit_catalog, can_add_products,
           is_co_owner, access_token, suspended_by, created_at
    from public.employees
    where store_id = public.current_store_id() and is_owner = false
  ) t;

  return jsonb_build_object('ok', true, 'employees', v_rows);
end;
$$;

create or replace function public.employee_state(
  p_actor_id uuid,
  p_actor_token text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_emp public.employees%rowtype;
begin
  select * into v_emp
  from public.employees e
  where e.id = p_actor_id
    and e.auth_user_id = auth.uid()
    and coalesce((auth.jwt() ->> 'iat')::bigint, 0) >= extract(epoch from e.pin_updated_at)::bigint
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Acces inconnu');
  end if;

  return jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'name', v_emp.name,
    'is_owner', v_emp.is_owner,
    'is_co_owner', v_emp.is_co_owner,
    'status', v_emp.status,
    'suspended_by', v_emp.suspended_by,
    'can_edit_catalog', v_emp.can_edit_catalog,
    'can_add_products', v_emp.can_add_products
  );
end;
$$;

create or replace function public.current_employee_profile()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'employee_id', e.id,
    'name', e.name,
    'phone', e.phone,
    'is_owner', e.is_owner,
    'is_co_owner', e.is_co_owner,
    'status', e.status,
    'suspended_by', e.suspended_by,
    'can_edit_catalog', e.can_edit_catalog,
    'can_add_products', e.can_add_products,
    'store_id', e.store_id,
    'store_name', s.name,
    'store_slug', s.slug
  )
  from public.employees e
  join public.stores s on s.id = e.store_id
  where e.auth_user_id = auth.uid()
    and coalesce((auth.jwt() ->> 'iat')::bigint, 0) >= extract(epoch from e.pin_updated_at)::bigint
  limit 1;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-icons', 'store-icons', true, 1048576, array['image/jpeg'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists store_icons_read on storage.objects;
drop policy if exists store_icons_insert on storage.objects;
drop policy if exists store_icons_update on storage.objects;
drop policy if exists store_icons_delete on storage.objects;

create policy store_icons_read on storage.objects
  for select using (bucket_id = 'store-icons');
create policy store_icons_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'store-icons'
    and name ~ '^[0-9a-fA-F-]{36}/icon[.]jpg$'
    and split_part(name, '/', 1) = public.current_store_id()::text
    and public.is_store_owner(public.current_store_id())
  );
create policy store_icons_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'store-icons'
    and name ~ '^[0-9a-fA-F-]{36}/icon[.]jpg$'
    and split_part(name, '/', 1) = public.current_store_id()::text
    and public.is_store_owner(public.current_store_id())
  )
  with check (
    bucket_id = 'store-icons'
    and name ~ '^[0-9a-fA-F-]{36}/icon[.]jpg$'
    and split_part(name, '/', 1) = public.current_store_id()::text
    and public.is_store_owner(public.current_store_id())
  );
create policy store_icons_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'store-icons'
    and name ~ '^[0-9a-fA-F-]{36}/icon[.]jpg$'
    and split_part(name, '/', 1) = public.current_store_id()::text
    and public.is_store_owner(public.current_store_id())
  );

commit;
