begin;

alter table public.stores
  add column if not exists slug text;

alter table public.products
  add column if not exists store_id uuid references public.stores(id);

alter table public.sales
  add column if not exists store_id uuid references public.stores(id);

alter table public.product_categories
  add column if not exists store_id uuid references public.stores(id);

alter table public.employees
  add column if not exists store_id uuid references public.stores(id),
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists temp_verification_code text,
  add column if not exists code_expires_at timestamptz,
  add column if not exists code_attempts integer not null default 0,
  add column if not exists pin_failed_attempts integer not null default 0,
  add column if not exists pin_locked_until timestamptz,
  add column if not exists pin_updated_at timestamptz not null default 'epoch';

alter table public.product_categories
  drop constraint if exists product_categories_slug_key;

do $$
declare
  v_legacy_store uuid;
  v_store_id uuid;
begin
  select id
    into v_legacy_store
  from public.stores
  order by is_demo desc, created_at, id
  limit 1
  for update;

  if v_legacy_store is null then
    insert into public.stores (name, is_demo)
    values ('Quincaillerie', false)
    returning id into v_legacy_store;
  end if;

  update public.stores
  set slug = coalesce(
    nullif(trim(both '-' from regexp_replace(
      translate(lower(coalesce(nullif(btrim(name), ''), 'boutique')),
        'àáâäãåçèéêëìíîïñòóôöõùúûüýÿ',
        'aaaaaaceeeeiiiinooooouuuuyy'),
      '[^a-z0-9]+', '-', 'g')), ''),
    'boutique-' || substr(replace(id::text, '-', ''), 1, 8)
  )
  where slug is null or btrim(slug) = '';

  with duplicates as (
    select id, slug,
           row_number() over (partition by slug order by created_at, id) as ordinal
    from public.stores
  )
  update public.stores s
  set slug = left(d.slug, 52) || '-' || substr(replace(s.id::text, '-', ''), 1, 8)
  from duplicates d
  where d.id = s.id
    and d.ordinal > 1;

  update public.products
  set store_id = v_legacy_store
  where store_id is null;

  update public.sales
  set store_id = v_legacy_store
  where store_id is null;

  update public.product_categories
  set store_id = v_legacy_store
  where store_id is null;

  update public.employees
  set store_id = v_legacy_store
  where store_id is null;

  for v_store_id in
    select id from public.stores where id <> v_legacy_store
  loop
    insert into public.product_categories (store_id, slug, name, color, icon, sort_order)
    select v_store_id, source.slug, source.name, source.color, source.icon, source.sort_order
    from public.product_categories source
    where source.store_id = v_legacy_store
      and not exists (
        select 1 from public.product_categories target
        where target.store_id = v_store_id and target.slug = source.slug
      );

    update public.products p
    set category_id = target.id
    from public.product_categories source
    join public.product_categories target
      on target.slug = source.slug and target.store_id = v_store_id
    where p.store_id = v_store_id
      and source.store_id = v_legacy_store
      and p.category_id = source.id;
  end loop;
end
$$;

alter table public.stores
  alter column slug set not null;

alter table public.products
  alter column store_id set not null;

alter table public.sales
  alter column store_id set not null;

alter table public.product_categories
  alter column store_id set not null;

alter table public.employees
  alter column store_id set not null;

create unique index if not exists stores_slug_unique
  on public.stores (slug);

create unique index if not exists product_categories_store_slug_unique
  on public.product_categories (store_id, slug);

create index if not exists products_store_idx
  on public.products (store_id);

create index if not exists sales_store_created_idx
  on public.sales (store_id, created_at desc);

create index if not exists employees_store_idx
  on public.employees (store_id);

create unique index if not exists employees_auth_user_unique
  on public.employees (auth_user_id)
  where auth_user_id is not null;

drop index if exists public.employees_single_owner;

create unique index if not exists employees_one_owner_per_store
  on public.employees (store_id)
  where is_owner = true;

create unique index if not exists employees_owner_phone_per_store
  on public.employees (store_id, phone)
  where is_owner = true and phone is not null;

alter table public.stores
  add constraint stores_slug_format
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

alter table public.employees
  add constraint employees_code_attempts_nonnegative
  check (code_attempts >= 0),
  add constraint employees_pin_failed_attempts_nonnegative
  check (pin_failed_attempts >= 0);

alter table public.employees
  drop column if exists owner_temp_hash,
  drop column if exists owner_claim_code;

create table if not exists public.employee_pin_recovery_grants (
  token_hash text primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists employee_pin_recovery_employee_idx
  on public.employee_pin_recovery_grants (employee_id, expires_at desc);

create table if not exists public.auth_ip_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null,
  blocked_until timestamptz
);

alter table public.employee_pin_recovery_grants enable row level security;
alter table public.auth_ip_rate_limits enable row level security;
revoke all on public.employee_pin_recovery_grants from public, anon, authenticated;
revoke all on public.auth_ip_rate_limits from public, anon, authenticated;

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select e.id
  from public.employees e
  where e.auth_user_id = auth.uid()
    and e.status = 'active'
    and coalesce((auth.jwt() ->> 'iat')::bigint, 0) >= extract(epoch from e.pin_updated_at)::bigint
  limit 1;
$$;

create or replace function public.current_store_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select e.store_id
  from public.employees e
  where e.auth_user_id = auth.uid()
    and e.status = 'active'
    and coalesce((auth.jwt() ->> 'iat')::bigint, 0) >= extract(epoch from e.pin_updated_at)::bigint
  limit 1;
$$;

create or replace function public.is_store_member(p_store_id uuid)
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
      and e.status = 'active'
      and coalesce((auth.jwt() ->> 'iat')::bigint, 0) >= extract(epoch from e.pin_updated_at)::bigint
  );
$$;

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
      and e.is_owner = true
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
        (e.is_owner and p_permission in ('edit_catalog', 'add_products', 'cancel_sale', 'manage_employees'))
        or (p_permission = 'edit_catalog' and e.can_edit_catalog)
        or (p_permission = 'add_products' and e.can_add_products)
      )
  );
$$;

create or replace function public.employee_name(
  p_actor_id uuid,
  p_actor_token text
) returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select e.name
  from public.employees e
  where e.id = p_actor_id
    and e.auth_user_id = auth.uid()
    and e.status = 'active'
    and coalesce((auth.jwt() ->> 'iat')::bigint, 0) >= extract(epoch from e.pin_updated_at)::bigint
  limit 1;
$$;

revoke all on function public.current_employee_id() from public, anon;
revoke all on function public.current_store_id() from public, anon;
revoke all on function public.is_store_member(uuid) from public, anon;
revoke all on function public.is_store_owner(uuid) from public, anon;
revoke all on function public.employee_can(uuid, text, text) from public, anon;
revoke all on function public.employee_name(uuid, text) from public, anon;
grant execute on function public.current_employee_id() to authenticated, service_role;
grant execute on function public.current_store_id() to authenticated, service_role;
grant execute on function public.is_store_member(uuid) to authenticated, service_role;
grant execute on function public.is_store_owner(uuid) to authenticated, service_role;
grant execute on function public.employee_can(uuid, text, text) to authenticated, service_role;
grant execute on function public.employee_name(uuid, text) to authenticated, service_role;

create or replace function public.guard_product_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_store_id uuid;
begin
  if auth.role() = 'service_role' or auth.role() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_store_id := public.current_store_id();
  if v_store_id is null then
    raise exception 'Authentification requise';
  end if;

  if tg_op = 'INSERT' then
    new.store_id := coalesce(new.store_id, v_store_id);
    if new.store_id <> v_store_id then
      raise exception 'Boutique non autorisee';
    end if;
  elsif old.store_id <> v_store_id or new.store_id <> old.store_id then
    raise exception 'Boutique non autorisee';
  end if;

  if new.category_id is not null and not exists (
    select 1 from public.product_categories c
    where c.id = new.category_id and c.store_id = v_store_id
  ) then
    raise exception 'Categorie de la boutique introuvable';
  end if;

  return new;
end;
$$;

create or replace function public.guard_sale_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_store_id uuid;
begin
  if auth.role() = 'service_role' or auth.role() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_store_id := public.current_store_id();
  if v_store_id is null then
    raise exception 'Authentification requise';
  end if;

  if tg_op = 'INSERT' then
    new.store_id := coalesce(new.store_id, v_store_id);
    if new.store_id <> v_store_id then
      raise exception 'Boutique non autorisee';
    end if;
    new.created_by := (
      select e.name from public.employees e
      where e.auth_user_id = auth.uid() and e.status = 'active'
      limit 1
    );
  elsif old.store_id <> v_store_id or new.store_id <> old.store_id then
    raise exception 'Boutique non autorisee';
  end if;

  return new;
end;
$$;

create or replace function public.guard_product_child_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_store_id uuid;
  v_product_id uuid;
begin
  if auth.role() = 'service_role' or auth.role() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_store_id := public.current_store_id();
  v_product_id := case when tg_op = 'DELETE' then old.product_id else new.product_id end;

  if v_store_id is null or not exists (
    select 1 from public.products p
    where p.id = v_product_id and p.store_id = v_store_id
  ) then
    raise exception 'Boutique non autorisee';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.guard_sale_child_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_store_id uuid;
  v_sale_id uuid;
  v_product_id uuid;
begin
  if auth.role() = 'service_role' or auth.role() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_store_id := public.current_store_id();
  v_sale_id := case when tg_op = 'DELETE' then old.sale_id else new.sale_id end;

  if v_store_id is null or not exists (
    select 1 from public.sales s
    where s.id = v_sale_id and s.store_id = v_store_id
  ) then
    raise exception 'Boutique non autorisee';
  end if;

  if tg_table_name = 'sale_items' then
    v_product_id := case when tg_op = 'DELETE' then old.product_id else new.product_id end;
    if not exists (
      select 1 from public.products p
      where p.id = v_product_id and p.store_id = v_store_id
    ) then
      raise exception 'Produit d''une autre boutique';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
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
    and e.is_owner = true
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

drop trigger if exists products_tenant_guard on public.products;
create trigger products_tenant_guard
before insert or update on public.products
for each row execute function public.guard_product_tenant();

drop trigger if exists sales_tenant_guard on public.sales;
create trigger sales_tenant_guard
before insert or update on public.sales
for each row execute function public.guard_sale_tenant();

drop trigger if exists product_sale_units_tenant_guard on public.product_sale_units;
create trigger product_sale_units_tenant_guard
before insert or update or delete on public.product_sale_units
for each row execute function public.guard_product_child_tenant();

drop trigger if exists stock_movements_tenant_guard on public.stock_movements;
create trigger stock_movements_tenant_guard
before insert or update or delete on public.stock_movements
for each row execute function public.guard_product_child_tenant();

drop trigger if exists sale_items_tenant_guard on public.sale_items;
create trigger sale_items_tenant_guard
before insert or update or delete on public.sale_items
for each row execute function public.guard_sale_child_tenant();

drop trigger if exists payments_tenant_guard on public.payments;
create trigger payments_tenant_guard
before insert or update or delete on public.payments
for each row execute function public.guard_sale_child_tenant();

drop trigger if exists employees_tenant_guard on public.employees;
create trigger employees_tenant_guard
before insert or update on public.employees
for each row execute function public.guard_employee_tenant();

create or replace function public.list_employees(
  p_actor_id uuid,
  p_actor_token text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_store_id uuid;
  v_rows jsonb;
begin
  if not public.employee_can(p_actor_id, p_actor_token, 'manage_employees') then
    return jsonb_build_object('ok', false, 'error', 'Action reservee au gerant');
  end if;

  v_store_id := public.current_store_id();
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at), '[]'::jsonb)
    into v_rows
  from (
    select id, name, phone, status, can_edit_catalog, can_add_products,
           access_token, suspended_by, created_at
    from public.employees
    where store_id = v_store_id and is_owner = false
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

revoke all on function public.current_employee_profile() from public, anon;
grant execute on function public.current_employee_profile() to authenticated;

create or replace function public.create_store_owner(
  p_store_name text,
  p_owner_name text,
  p_phone text,
  p_slug text,
  p_pin text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_store_id uuid;
  v_employee_id uuid;
  v_seed_store uuid;
begin
  if nullif(btrim(p_store_name), '') is null
     or nullif(btrim(p_owner_name), '') is null
     or nullif(btrim(p_phone), '') is null
     or coalesce(p_slug, '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'Informations de boutique invalides');
  end if;

  insert into public.stores (name, phone, slug, is_demo)
  values (btrim(p_store_name), btrim(p_phone), p_slug, false)
  returning id into v_store_id;

  select id into v_seed_store
  from public.stores
  where id <> v_store_id
  order by created_at, id
  limit 1;

  if v_seed_store is not null then
    insert into public.product_categories (store_id, slug, name, color, icon, sort_order)
    select v_store_id, slug, name, color, icon, sort_order
    from public.product_categories
    where store_id = v_seed_store;
  end if;

  insert into public.employees (
    store_id, name, phone, status, can_edit_catalog, can_add_products,
    access_token, is_owner, owner_secret_hash
  )
  values (
    v_store_id, btrim(p_owner_name), btrim(p_phone), 'active', true, true,
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    true, crypt(p_pin, gen_salt('bf', 12))
  )
  returning id into v_employee_id;

  return jsonb_build_object(
    'ok', true,
    'store_id', v_store_id,
    'employee_id', v_employee_id,
    'name', btrim(p_owner_name),
    'slug', p_slug
  );
end;
$$;

create or replace function public.normalize_ci_phone(p_phone text)
returns text
language sql
immutable
set search_path = public
as $$
  with raw as (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits
  ),
  national as (
    select case when left(digits, 2) = '00' then substr(digits, 3) else digits end as digits
    from raw
  )
  select case
    when left(digits, 3) = '225' and length(digits) = 13 then digits
    when length(digits) = 10 then '225' || digits
    else null
  end
  from national;
$$;

create or replace function public.verify_owner_pin(
  p_slug text,
  p_phone text,
  p_pin text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_emp public.employees%rowtype;
begin
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'Numero ou PIN incorrect');
  end if;

  select e.* into v_emp
  from public.employees e
  join public.stores s on s.id = e.store_id
  where s.slug = p_slug
    and public.normalize_ci_phone(e.phone) = public.normalize_ci_phone(p_phone)
    and e.is_owner = true
  limit 1
  for update of e;

  if not found or v_emp.status <> 'active'
     or v_emp.owner_secret_hash is null
     or (v_emp.pin_locked_until is not null and v_emp.pin_locked_until > now()) then
    return jsonb_build_object('ok', false, 'error', 'Numero ou PIN incorrect');
  end if;

  if crypt(p_pin, v_emp.owner_secret_hash) <> v_emp.owner_secret_hash then
    update public.employees
    set pin_failed_attempts = pin_failed_attempts + 1,
        pin_locked_until = case
          when pin_failed_attempts + 1 >= 5 then now() + interval '15 minutes'
          else pin_locked_until
        end,
        updated_at = now()
    where id = v_emp.id;
    return jsonb_build_object('ok', false, 'error', 'Numero ou PIN incorrect');
  end if;

  update public.employees
  set pin_failed_attempts = 0,
      pin_locked_until = null,
      updated_at = now()
  where id = v_emp.id;

  return jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'auth_user_id', v_emp.auth_user_id,
    'name', v_emp.name,
    'store_id', v_emp.store_id
  );
end;
$$;

create or replace function public.link_employee_auth(
  p_employee_id uuid,
  p_auth_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  select auth_user_id into v_existing
  from public.employees
  where id = p_employee_id
  for update;

  if not found or (v_existing is not null and v_existing <> p_auth_user_id) then
    return false;
  end if;

  update public.employees
  set auth_user_id = p_auth_user_id, updated_at = now()
  where id = p_employee_id;
  return true;
end;
$$;

create or replace function public.verify_owner_recovery_code(
  p_slug text,
  p_phone text,
  p_code text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.employees%rowtype;
  v_grant text;
begin
  if coalesce(p_code, '') !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'Code invalide ou expire');
  end if;

  select e.* into v_emp
  from public.employees e
  join public.stores s on s.id = e.store_id
  where s.slug = p_slug
    and public.normalize_ci_phone(e.phone) = public.normalize_ci_phone(p_phone)
    and e.is_owner = true
  limit 1
  for update of e;

  if not found
     or v_emp.temp_verification_code is null
     or v_emp.code_expires_at is null
     or v_emp.code_expires_at <= now()
     or v_emp.code_attempts >= 5 then
    if found and v_emp.code_expires_at <= now() then
      update public.employees
      set temp_verification_code = null,
          code_expires_at = null,
          code_attempts = 0,
          updated_at = now()
      where id = v_emp.id;
    end if;
    return jsonb_build_object('ok', false, 'error', 'Code invalide ou expire');
  end if;

  if v_emp.temp_verification_code <> p_code then
    update public.employees
    set code_attempts = code_attempts + 1,
        temp_verification_code = case when code_attempts + 1 >= 5 then null else temp_verification_code end,
        code_expires_at = case when code_attempts + 1 >= 5 then null else code_expires_at end,
        updated_at = now()
    where id = v_emp.id;
    return jsonb_build_object('ok', false, 'error', 'Code invalide ou expire');
  end if;

  v_grant := encode(gen_random_bytes(32), 'hex');
  insert into public.employee_pin_recovery_grants (token_hash, employee_id, expires_at)
  values (encode(digest(v_grant, 'sha256'), 'hex'), v_emp.id, now() + interval '5 minutes');

  update public.employees
  set temp_verification_code = null,
      code_expires_at = null,
      code_attempts = 0,
      updated_at = now()
  where id = v_emp.id;

  return jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'auth_user_id', v_emp.auth_user_id,
    'name', v_emp.name,
    'recovery_token', v_grant
  );
end;
$$;

create or replace function public.complete_owner_pin_recovery(
  p_slug text,
  p_phone text,
  p_recovery_token text,
  p_new_pin text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.employees%rowtype;
  v_grant public.employee_pin_recovery_grants%rowtype;
begin
  if coalesce(p_new_pin, '') !~ '^[0-9]{4}$' or length(coalesce(p_recovery_token, '')) <> 64 then
    return jsonb_build_object('ok', false, 'error', 'Code ou nouveau PIN invalide');
  end if;

  select g.* into v_grant
  from public.employee_pin_recovery_grants g
  where g.token_hash = encode(digest(p_recovery_token, 'sha256'), 'hex')
    and g.consumed_at is null
    and g.expires_at > now()
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Cette autorisation a expire. Recommence la recuperation.');
  end if;

  select e.* into v_emp
  from public.employees e
  join public.stores s on s.id = e.store_id
  where e.id = v_grant.employee_id
    and public.normalize_ci_phone(e.phone) = public.normalize_ci_phone(p_phone)
    and e.is_owner = true
    and s.slug = p_slug
  for update of e;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Compte introuvable');
  end if;

  update public.employees
  set owner_secret_hash = crypt(p_new_pin, gen_salt('bf', 12)),
      pin_failed_attempts = 0,
      pin_locked_until = null,
      pin_updated_at = date_trunc('second', now()) + interval '1 second',
      updated_at = now()
  where id = v_emp.id;

  update public.employee_pin_recovery_grants
  set consumed_at = now()
  where token_hash = v_grant.token_hash;

  return jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'auth_user_id', v_emp.auth_user_id,
    'name', v_emp.name
  );
end;
$$;

create or replace function public.consume_auth_ip_limit(p_key_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit public.auth_ip_rate_limits%rowtype;
begin
  if p_key_hash is null or length(p_key_hash) <> 64 then
    return false;
  end if;

  insert into public.auth_ip_rate_limits (key_hash, window_started_at, attempt_count)
  values (p_key_hash, now(), 1)
  on conflict (key_hash) do nothing;

  select * into v_limit
  from public.auth_ip_rate_limits
  where key_hash = p_key_hash
  for update;

  if v_limit.blocked_until is not null and v_limit.blocked_until > now() then
    return false;
  end if;

  if v_limit.window_started_at < now() - interval '10 minutes' then
    update public.auth_ip_rate_limits
    set window_started_at = now(), attempt_count = 1, blocked_until = null
    where key_hash = p_key_hash;
    return true;
  end if;

  if v_limit.attempt_count >= 20 then
    update public.auth_ip_rate_limits
    set blocked_until = now() + interval '10 minutes'
    where key_hash = p_key_hash;
    return false;
  end if;

  update public.auth_ip_rate_limits
  set attempt_count = attempt_count + 1
  where key_hash = p_key_hash;
  return true;
end;
$$;

do $$
begin
  if to_regclass('public.sale_payments') is not null then
    execute 'drop trigger if exists sale_payments_tenant_guard on public.sale_payments';
    execute 'create trigger sale_payments_tenant_guard before insert or update or delete on public.sale_payments for each row execute function public.guard_sale_child_tenant()';
  end if;
end
$$;

drop policy if exists "st_sel" on public.stores;
drop policy if exists "st_ins" on public.stores;
drop policy if exists "st_upd" on public.stores;
drop policy if exists "st_del" on public.stores;
drop policy if exists stores_select_tenant on public.stores;
drop policy if exists stores_update_owner on public.stores;
create policy stores_select_tenant on public.stores
  for select to authenticated using (public.is_store_member(id));
create policy stores_update_owner on public.stores
  for update to authenticated using (public.is_store_owner(id))
  with check (public.is_store_owner(id));

drop policy if exists "pc_sel" on public.product_categories;
drop policy if exists "pc_ins" on public.product_categories;
drop policy if exists "pc_upd" on public.product_categories;
drop policy if exists "pc_del" on public.product_categories;
drop policy if exists categories_select_tenant on public.product_categories;
create policy categories_select_tenant on public.product_categories
  for select to authenticated using (public.is_store_member(store_id));

drop policy if exists "p_sel" on public.products;
drop policy if exists "p_ins" on public.products;
drop policy if exists "p_upd" on public.products;
drop policy if exists "p_del" on public.products;
drop policy if exists products_select_tenant on public.products;
create policy products_select_tenant on public.products
  for select to authenticated using (public.is_store_member(store_id));

drop policy if exists "psu_sel" on public.product_sale_units;
drop policy if exists "psu_ins" on public.product_sale_units;
drop policy if exists "psu_upd" on public.product_sale_units;
drop policy if exists "psu_del" on public.product_sale_units;
drop policy if exists sale_units_select_tenant on public.product_sale_units;
create policy sale_units_select_tenant on public.product_sale_units
  for select to authenticated using (
    exists (
      select 1 from public.products p
      where p.id = product_sale_units.product_id
        and public.is_store_member(p.store_id)
    )
  );

drop policy if exists "s_sel" on public.sales;
drop policy if exists "s_ins" on public.sales;
drop policy if exists "s_upd" on public.sales;
drop policy if exists "s_del" on public.sales;
drop policy if exists sales_select_tenant on public.sales;
create policy sales_select_tenant on public.sales
  for select to authenticated using (public.is_store_member(store_id));

drop policy if exists "si_sel" on public.sale_items;
drop policy if exists "si_ins" on public.sale_items;
drop policy if exists "si_upd" on public.sale_items;
drop policy if exists "si_del" on public.sale_items;
drop policy if exists sale_items_select_tenant on public.sale_items;
create policy sale_items_select_tenant on public.sale_items
  for select to authenticated using (
    exists (
      select 1 from public.sales s
      where s.id = sale_items.sale_id
        and public.is_store_member(s.store_id)
    )
  );

drop policy if exists "sm_sel" on public.stock_movements;
drop policy if exists "sm_ins" on public.stock_movements;
drop policy if exists "sm_upd" on public.stock_movements;
drop policy if exists "sm_del" on public.stock_movements;
drop policy if exists stock_movements_select_tenant on public.stock_movements;
create policy stock_movements_select_tenant on public.stock_movements
  for select to authenticated using (
    exists (
      select 1 from public.products p
      where p.id = stock_movements.product_id
        and public.is_store_member(p.store_id)
    )
  );

drop policy if exists "pay_sel" on public.payments;
drop policy if exists "pay_ins" on public.payments;
drop policy if exists "pay_upd" on public.payments;
drop policy if exists "pay_del" on public.payments;
drop policy if exists payments_select_tenant on public.payments;
create policy payments_select_tenant on public.payments
  for select to authenticated using (
    exists (
      select 1 from public.sales s
      where s.id = payments.sale_id
        and public.is_store_member(s.store_id)
    )
  );

do $$
begin
  if to_regclass('public.sale_payments') is not null then
    execute 'drop policy if exists "sp_sel" on public.sale_payments';
    execute 'drop policy if exists "sp_ins" on public.sale_payments';
    execute 'drop policy if exists "sp_upd" on public.sale_payments';
    execute 'drop policy if exists "sp_del" on public.sale_payments';
    execute 'drop policy if exists sale_payments_select_tenant on public.sale_payments';
    execute $policy$
      create policy sale_payments_select_tenant on public.sale_payments
      for select to authenticated using (
        exists (
          select 1 from public.sales s
          where s.id = sale_payments.sale_id
            and public.is_store_member(s.store_id)
        )
      )
    $policy$;
  end if;
end
$$;

alter table public.stores enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_sale_units enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.payments enable row level security;
alter table public.employees enable row level security;

revoke all on public.employees from public, anon, authenticated;
revoke all on public.stores from anon;
revoke all on public.product_categories from anon;
revoke all on public.products from anon;
revoke all on public.product_sale_units from anon;
revoke all on public.sales from anon;
revoke all on public.sale_items from anon;
revoke all on public.stock_movements from anon;
revoke all on public.payments from anon;

drop policy if exists "product_images_insert" on storage.objects;
drop policy if exists "product_images_update" on storage.objects;
drop policy if exists "product_images_delete" on storage.objects;
create policy product_images_insert_tenant on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and name ~ '^products/[0-9a-fA-F-]{36}/'
    and exists (
      select 1 from public.products p
      where p.id = split_part(name, '/', 2)::uuid
        and public.is_store_member(p.store_id)
    )
  );
create policy product_images_update_tenant on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and name ~ '^products/[0-9a-fA-F-]{36}/'
    and exists (
      select 1 from public.products p
      where p.id = split_part(name, '/', 2)::uuid
        and public.is_store_member(p.store_id)
    )
  )
  with check (
    bucket_id = 'product-images'
    and name ~ '^products/[0-9a-fA-F-]{36}/'
    and exists (
      select 1 from public.products p
      where p.id = split_part(name, '/', 2)::uuid
        and public.is_store_member(p.store_id)
    )
  );
create policy product_images_delete_tenant on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and name ~ '^products/[0-9a-fA-F-]{36}/'
    and exists (
      select 1 from public.products p
      where p.id = split_part(name, '/', 2)::uuid
        and public.is_store_member(p.store_id)
    )
  );

do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('ensure_owner', 'reset_owner_secret', 'accept_invite')
  loop
    execute format('drop function %s', v_function.signature);
  end loop;

  for v_function in
    select p.oid::regprocedure as signature, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'employee_can', 'employee_name', 'list_employees', 'create_employee',
        'update_employee', 'regenerate_invite', 'employee_state', 'save_product',
        'register_sale', 'cancel_sale', 'record_arrival', 'record_sale_payment'
      )
  loop
    execute format('revoke all on function %s from public, anon', v_function.signature);
    execute format('grant execute on function %s to authenticated', v_function.signature);
  end loop;
end
$$;

revoke all on function public.create_store_owner(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.verify_owner_pin(text, text, text) from public, anon, authenticated;
revoke all on function public.link_employee_auth(uuid, uuid) from public, anon, authenticated;
revoke all on function public.verify_owner_recovery_code(text, text, text) from public, anon, authenticated;
revoke all on function public.complete_owner_pin_recovery(text, text, text, text) from public, anon, authenticated;
revoke all on function public.consume_auth_ip_limit(text) from public, anon, authenticated;
revoke all on function public.normalize_ci_phone(text) from public, anon, authenticated;
grant execute on function public.create_store_owner(text, text, text, text, text) to service_role;
grant execute on function public.verify_owner_pin(text, text, text) to service_role;
grant execute on function public.link_employee_auth(uuid, uuid) to service_role;
grant execute on function public.verify_owner_recovery_code(text, text, text) to service_role;
grant execute on function public.complete_owner_pin_recovery(text, text, text, text) to service_role;
grant execute on function public.consume_auth_ip_limit(text) to service_role;

notify pgrst, 'reload schema';
commit;

-- Manual PIN recovery setup (Supabase SQL Editor, after identity verification):
-- update public.employees
-- set temp_verification_code = '1234',
--     code_expires_at = now() + interval '15 minutes',
--     code_attempts = 0
-- where is_owner = true
--   and store_id = (select id from public.stores where slug = 'votre-slug');
