begin;

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

create or replace function public.create_store_category(
  p_actor_id uuid,
  p_name text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_store_id uuid;
  v_slug text;
  v_category public.product_categories%rowtype;
begin
  if not public.employee_can(p_actor_id, null, 'edit_catalog') then
    return jsonb_build_object('ok', false, 'error', 'Action reservee au gerant');
  end if;

  if nullif(btrim(p_name), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Le nom de la categorie est obligatoire');
  end if;

  v_slug := trim(both '-' from regexp_replace(
    translate(lower(btrim(p_name)),
      'àáâäãåçèéêëìíîïñòóôöõùúûüýÿ',
      'aaaaaaceeeeiiiinooooouuuuyy'),
    '[^a-z0-9]+', '-', 'g'
  ));
  if v_slug = '' then
    return jsonb_build_object('ok', false, 'error', 'Le nom de la categorie est invalide');
  end if;

  v_store_id := public.current_store_id();
  insert into public.product_categories (store_id, slug, name, color, sort_order)
  values (
    v_store_id,
    v_slug,
    btrim(p_name),
    'blue',
    coalesce((
      select max(sort_order) + 1
      from public.product_categories
      where store_id = v_store_id
    ), 0)
  )
  on conflict (store_id, slug) do nothing
  returning * into v_category;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Une categorie portant ce nom existe deja');
  end if;

  return jsonb_build_object('ok', true, 'category', to_jsonb(v_category));
end;
$$;

create or replace function public.delete_store_category(
  p_actor_id uuid,
  p_category_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_category_id uuid;
begin
  if not public.employee_can(p_actor_id, null, 'edit_catalog') then
    return jsonb_build_object('ok', false, 'error', 'Action reservee au gerant');
  end if;

  delete from public.product_categories
  where id = p_category_id
    and store_id = public.current_store_id()
  returning id into v_category_id;

  if v_category_id is null then
    return jsonb_build_object('ok', false, 'error', 'Categorie introuvable dans cette boutique');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.create_store_owner(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_store_owner(text, text, text, text, text) to service_role;
revoke all on function public.create_store_category(uuid, text) from public, anon;
revoke all on function public.delete_store_category(uuid, uuid) from public, anon;
grant execute on function public.create_store_category(uuid, text) to authenticated;
grant execute on function public.delete_store_category(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
