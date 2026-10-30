/*
# Étape 5 — Employés, permissions vérifiées côté serveur, durcissement RLS

Objectif : les autorisations (modifier le stock/les prix, ajouter des produits,
annuler une vente) ne sont plus seulement cachées dans l'interface, elles sont
VÉRIFIÉES EN BASE sur chaque écriture.

## 1. Table `employees`
Un acteur = une ligne `employees` identifiée par un jeton secret
(`access_token`, 64 caractères aléatoires).
- Le BOSS est la ligne `is_owner = true` (unique). Son jeton est le jeton
  d'appareil généré au premier lancement sur son téléphone (`ensure_owner`).
- Les EMPLOYÉS sont créés par le boss ; leur `access_token` sert à la fois de
  lien d'invitation WhatsApp et de jeton d'accès permanent.
- `status` : 'invited' (invitation en attente) | 'active' | 'suspended'.

La table n'a AUCUNE politique RLS : elle est inaccessible en lecture/écriture
directe par le client. Tout passe par les fonctions SECURITY DEFINER.

## 2. Durcissement RLS
Les politiques `INSERT/UPDATE/DELETE` permissives (`true`) sont retirées sur
`products`, `product_sale_units`, `stock_movements`, `sales`, `sale_items`,
`payments`, `sale_payments`. Les écritures ne sont plus possibles que par les
fonctions SECURITY DEFINER (`register_sale`, `cancel_sale`,
`record_sale_payment`, `save_product`, …) qui vérifient l'acteur.
La LECTURE reste ouverte (données partagées de la quincaillerie).

## 3. Fonctions
- `ensure_owner(p_device_token)`           — réclame/retrouve le boss.
- `employee_can(p_actor_id, token, perm)`  — contrôle de permission.
- `save_product(...)`                      — création / modification / archivage
  d'un produit (prix Gros/Détail, stock, photo) avec traçabilité du stock.
- `list_employees(...)`, `create_employee(...)`, `update_employee(...)`,
  `regenerate_invite(...)`                  — gestion par le boss uniquement.
- `accept_invite(token)`, `employee_state(...)` — côté employé.

## 4. Idempotence
`stock_movements.idempotency_key` (index unique partiel) permet de rejouer sans
risque les ajustements de stock mis en file d'attente hors-ligne.

## 5. Notes
Aucune donnée existante n'est supprimée. Les ventes et mouvements déjà
enregistrés conservent leur `created_by` (texte), donc l'historique d'un
employé révoqué reste intact.
*/

-- ============ 1. Table: employees =======================================

create table if not exists employees (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  phone            text,
  status           text not null default 'invited'
                     check (status in ('invited', 'active', 'suspended')),
  can_edit_catalog boolean not null default false,
  can_add_products boolean not null default false,
  access_token     text not null unique
                     default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  is_owner         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Un seul boss.
create unique index if not exists employees_single_owner
  on employees (is_owner) where is_owner = true;

alter table employees enable row level security;
-- Aucune politique : accès exclusivement via les fonctions SECURITY DEFINER.

-- ============ 2. Idempotence des mouvements de stock ====================

alter table stock_movements
  add column if not exists idempotency_key text;

create unique index if not exists sm_idem_uniq
  on stock_movements (idempotency_key) where idempotency_key is not null;

-- ============ 3. Contrôle de permission =================================

create or replace function employee_can(
  p_actor_id    uuid,
  p_actor_token text,
  p_permission  text
) returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from employees e
    where e.id = p_actor_id
      and e.access_token = p_actor_token
      and e.status = 'active'
      and (
        (e.is_owner and p_permission in ('edit_catalog', 'add_products', 'cancel_sale', 'manage_employees'))
        or (p_permission = 'edit_catalog'  and e.can_edit_catalog)
        or (p_permission = 'add_products'  and e.can_add_products)
      )
  );
$$;

create or replace function employee_name(
  p_actor_id    uuid,
  p_actor_token text
) returns text
language sql
security definer
set search_path = public
as $$
  select e.name from employees e
  where e.id = p_actor_id and e.access_token = p_actor_token and e.status = 'active'
  limit 1;
$$;

grant execute on function employee_can(uuid, text, text)  to anon, authenticated;
grant execute on function employee_name(uuid, text)       to anon, authenticated;

-- ============ 4. Boss : réclamation de l'appareil ======================

create or replace function ensure_owner(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees%rowtype;
begin
  if p_device_token is null or length(p_device_token) < 32 then
    return jsonb_build_object('ok', false, 'error', 'Jeton d''appareil invalide');
  end if;

  select * into v_emp from employees where is_owner = true limit 1;
  if found then
    if v_emp.access_token = p_device_token then
      return jsonb_build_object(
        'ok', true, 'is_owner', true,
        'employee_id', v_emp.id, 'name', v_emp.name, 'token', v_emp.access_token,
        'status', v_emp.status
      );
    end if;
    -- Un boss existe déjà sur un autre appareil : cet appareil n'est pas le boss.
    return jsonb_build_object('ok', true, 'is_owner', false);
  end if;

  insert into employees (name, phone, status, can_edit_catalog, can_add_products, access_token, is_owner)
  values ('Boss', null, 'active', true, true, p_device_token, true)
  returning * into v_emp;

  return jsonb_build_object(
    'ok', true, 'is_owner', true,
    'employee_id', v_emp.id, 'name', v_emp.name, 'token', v_emp.access_token,
    'status', v_emp.status
  );
end;
$$;

grant execute on function ensure_owner(text) to anon, authenticated;

-- ============ 5. Écritures catalogue vérifiées ==========================

create or replace function save_product(
  p_actor_id            uuid,
  p_actor_token         text,
  p_mode                text,
  p_product_id          uuid    default null,
  p_name                text    default null,
  p_category_id         uuid    default null,
  p_image_url           text    default null,
  p_stock_qty           numeric default null,
  p_low_stock_threshold numeric default null,
  p_price_gros          numeric default null,
  p_price_detail        numeric default null,
  p_idempotency_key     text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod    products%rowtype;
  v_actor   text;
  v_id      uuid;
  v_delta   numeric(14,3);
  v_note    text;
begin
  if p_actor_id is null then
    return jsonb_build_object('ok', false, 'error', 'Action non autorisée');
  end if;

  v_actor := employee_name(p_actor_id, p_actor_token);
  if v_actor is null then
    return jsonb_build_object('ok', false, 'error', 'Demande au boss de t''autoriser avant d''effectuer cette action');
  end if;

  -- ---------------- Archivage ----------------
  if p_mode = 'archive' then
    if not employee_can(p_actor_id, p_actor_token, 'edit_catalog') then
      return jsonb_build_object('ok', false, 'error', 'Demande au boss de t''autoriser avant d''effectuer cette action');
    end if;
    if p_product_id is null then
      return jsonb_build_object('ok', false, 'error', 'Produit introuvable');
    end if;
    update products set is_archived = true, updated_at = now() where id = p_product_id;
    return jsonb_build_object('ok', true, 'product_id', p_product_id, 'archived', true);
  end if;

  -- ---------------- Création ----------------
  if p_mode = 'create' then
    if not employee_can(p_actor_id, p_actor_token, 'add_products') then
      return jsonb_build_object('ok', false, 'error', 'Demande au boss de t''autoriser avant d''effectuer cette action');
    end if;
    if p_name is null or btrim(p_name) = '' then
      return jsonb_build_object('ok', false, 'error', 'Le nom du produit est obligatoire');
    end if;

    v_id := coalesce(p_product_id, gen_random_uuid());

    -- Rejeu hors-ligne : le produit existe déjà, on ne fait rien.
    if exists (select 1 from products where id = v_id) then
      return jsonb_build_object('ok', true, 'product_id', v_id, 'replayed', true);
    end if;

    insert into products (id, category_id, name, image_url, stock_unit, stock_qty,
                          low_stock_threshold, is_active, is_archived)
    values (v_id, p_category_id, btrim(p_name), p_image_url, 'unité', p_stock_qty,
            coalesce(p_low_stock_threshold, 0), true, false);

    insert into product_sale_units (product_id, unit, price, factor_to_stock, is_default, allow_decimal)
    values (v_id, 'Gros', coalesce(p_price_gros, 0), 1, false, false),
           (v_id, 'Détail', coalesce(p_price_detail, 0), 1, true, false)
    on conflict (product_id, unit) do update
      set price = excluded.price, factor_to_stock = 1,
          is_default = excluded.is_default, allow_decimal = false;

    if coalesce(p_stock_qty, 0) <> 0 then
      insert into stock_movements (product_id, reason, delta, unit, quantity, note, created_by, idempotency_key)
      values (v_id, 'adjustment', coalesce(p_stock_qty, 0), 'unité', abs(coalesce(p_stock_qty, 0)),
              'Création du produit', v_actor, p_idempotency_key);
    end if;

    return jsonb_build_object('ok', true, 'product_id', v_id, 'created', true);
  end if;

  -- ---------------- Modification ----------------
  if p_mode = 'update' then
    if not employee_can(p_actor_id, p_actor_token, 'edit_catalog') then
      return jsonb_build_object('ok', false, 'error', 'Demande au boss de t''autoriser avant d''effectuer cette action');
    end if;
    if p_product_id is null then
      return jsonb_build_object('ok', false, 'error', 'Produit introuvable');
    end if;

    select * into v_prod from products where id = p_product_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'Produit introuvable');
    end if;

    -- Rejeu hors-ligne d'un ajustement de stock : déjà appliqué.
    if p_idempotency_key is not null
       and exists (select 1 from stock_movements where idempotency_key = p_idempotency_key) then
      return jsonb_build_object('ok', true, 'product_id', p_product_id, 'replayed', true);
    end if;

    update products set
      name        = coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_prod.name),
      image_url   = coalesce(p_image_url, v_prod.image_url),
      stock_qty   = p_stock_qty,
      updated_at  = now()
    where id = p_product_id;

    insert into product_sale_units (product_id, unit, price, factor_to_stock, is_default, allow_decimal)
    values (p_product_id, 'Gros', coalesce(p_price_gros, 0), 1, false, false),
           (p_product_id, 'Détail', coalesce(p_price_detail, 0), 1, true, false)
    on conflict (product_id, unit) do update
      set price = excluded.price, factor_to_stock = 1,
          is_default = excluded.is_default, allow_decimal = false;

    -- Trace l'ajustement de stock dans le journal (avec l'employé responsable).
    if p_stock_qty is distinct from v_prod.stock_qty then
      v_delta := coalesce(p_stock_qty, 0) - coalesce(v_prod.stock_qty, 0);
      v_note  := case when v_prod.stock_qty is null then 'Stock configuré' else 'Modification du stock' end;
      if v_delta <> 0 then
        insert into stock_movements (product_id, reason, delta, unit, quantity, note, created_by, idempotency_key)
        values (p_product_id, 'adjustment', v_delta, v_prod.stock_unit, abs(v_delta),
                v_note, v_actor, p_idempotency_key);
      end if;
    end if;

    return jsonb_build_object('ok', true, 'product_id', p_product_id, 'updated', true);
  end if;

  return jsonb_build_object('ok', false, 'error', 'Opération inconnue');
end;
$$;

grant execute on function save_product(uuid, text, text, uuid, text, uuid, text, numeric, numeric, numeric, numeric, text)
  to anon, authenticated;

-- ============ 6. Gestion des employés (boss uniquement) ================

create or replace function list_employees(
  p_actor_id    uuid,
  p_actor_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not employee_can(p_actor_id, p_actor_token, 'manage_employees') then
    return jsonb_build_object('ok', false, 'error', 'Action réservée au boss');
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) into v_rows
  from (
    select id, name, phone, status, can_edit_catalog, can_add_products,
           access_token, created_at
    from employees
    where is_owner = false
    order by created_at asc
  ) t;

  return jsonb_build_object('ok', true, 'employees', v_rows);
end;
$$;

create or replace function create_employee(
  p_actor_id        uuid,
  p_actor_token     text,
  p_name            text,
  p_phone           text default null,
  p_can_edit        boolean default false,
  p_can_add         boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees%rowtype;
begin
  if not employee_can(p_actor_id, p_actor_token, 'manage_employees') then
    return jsonb_build_object('ok', false, 'error', 'Action réservée au boss');
  end if;
  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('ok', false, 'error', 'Le nom de l''employé est obligatoire');
  end if;

  insert into employees (name, phone, status, can_edit_catalog, can_add_products)
  values (btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''), 'invited',
          coalesce(p_can_edit, false), coalesce(p_can_add, false))
  returning * into v_emp;

  return jsonb_build_object(
    'ok', true,
    'employee', jsonb_build_object(
      'id', v_emp.id, 'name', v_emp.name, 'phone', v_emp.phone,
      'status', v_emp.status, 'can_edit_catalog', v_emp.can_edit_catalog,
      'can_add_products', v_emp.can_add_products, 'access_token', v_emp.access_token,
      'created_at', v_emp.created_at
    )
  );
end;
$$;

create or replace function update_employee(
  p_actor_id     uuid,
  p_actor_token  text,
  p_employee_id  uuid,
  p_status       text    default null,
  p_can_edit     boolean default null,
  p_can_add      boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees%rowtype;
begin
  if not employee_can(p_actor_id, p_actor_token, 'manage_employees') then
    return jsonb_build_object('ok', false, 'error', 'Action réservée au boss');
  end if;

  select * into v_emp from employees where id = p_employee_id and is_owner = false;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Employé introuvable');
  end if;

  if p_status is not null and p_status not in ('invited', 'active', 'suspended') then
    return jsonb_build_object('ok', false, 'error', 'Statut invalide');
  end if;

  update employees set
    status           = coalesce(p_status, v_emp.status),
    can_edit_catalog = coalesce(p_can_edit, v_emp.can_edit_catalog),
    can_add_products = coalesce(p_can_add, v_emp.can_add_products),
    updated_at       = now()
  where id = p_employee_id
  returning * into v_emp;

  return jsonb_build_object(
    'ok', true,
    'employee', jsonb_build_object(
      'id', v_emp.id, 'name', v_emp.name, 'phone', v_emp.phone,
      'status', v_emp.status, 'can_edit_catalog', v_emp.can_edit_catalog,
      'can_add_products', v_emp.can_add_products, 'access_token', v_emp.access_token
    )
  );
end;
$$;

create or replace function regenerate_invite(
  p_actor_id     uuid,
  p_actor_token  text,
  p_employee_id  uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees%rowtype;
begin
  if not employee_can(p_actor_id, p_actor_token, 'manage_employees') then
    return jsonb_build_object('ok', false, 'error', 'Action réservée au boss');
  end if;

  update employees
    set access_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
        status       = 'invited',
        updated_at   = now()
  where id = p_employee_id and is_owner = false
  returning * into v_emp;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Employé introuvable');
  end if;

  return jsonb_build_object(
    'ok', true,
    'employee', jsonb_build_object(
      'id', v_emp.id, 'name', v_emp.name, 'phone', v_emp.phone,
      'status', v_emp.status, 'can_edit_catalog', v_emp.can_edit_catalog,
      'can_add_products', v_emp.can_add_products, 'access_token', v_emp.access_token
    )
  );
end;
$$;

grant execute on function list_employees(uuid, text)                          to anon, authenticated;
grant execute on function create_employee(uuid, text, text, text, boolean, boolean) to anon, authenticated;
grant execute on function update_employee(uuid, text, uuid, text, boolean, boolean) to anon, authenticated;
grant execute on function regenerate_invite(uuid, text, uuid)                 to anon, authenticated;

-- ============ 7. Côté employé : accepter / rafraîchir ==================

create or replace function accept_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees%rowtype;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'error', 'Invitation invalide');
  end if;

  select * into v_emp from employees
    where access_token = p_token and is_owner = false;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invitation invalide ou expirée');
  end if;
  if v_emp.status = 'suspended' then
    return jsonb_build_object('ok', false, 'error', 'Ton accès a été suspendu. Contacte le boss.');
  end if;

  if v_emp.status = 'invited' then
    update employees set status = 'active', updated_at = now()
      where id = v_emp.id
      returning * into v_emp;
  end if;

  return jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'name', v_emp.name,
    'token', v_emp.access_token,
    'can_edit_catalog', v_emp.can_edit_catalog,
    'can_add_products', v_emp.can_add_products,
    'status', v_emp.status
  );
end;
$$;

create or replace function employee_state(
  p_actor_id    uuid,
  p_actor_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees%rowtype;
begin
  select * into v_emp from employees
    where id = p_actor_id and access_token = p_actor_token;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Accès inconnu');
  end if;

  return jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'name', v_emp.name,
    'is_owner', v_emp.is_owner,
    'status', v_emp.status,
    'can_edit_catalog', v_emp.can_edit_catalog,
    'can_add_products', v_emp.can_add_products
  );
end;
$$;

grant execute on function accept_invite(text)          to anon, authenticated;
grant execute on function employee_state(uuid, text)   to anon, authenticated;

-- ============ 8. Annulation de vente : boss uniquement ==================

create or replace function cancel_sale(
  p_sale_id       uuid,
  p_reason        text default null,
  p_cancelled_by  text default null,
  p_actor_id      uuid default null,
  p_actor_token   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale    sales%rowtype;
  v_item    sale_items%rowtype;
  v_count   int := 0;
begin
  if not employee_can(p_actor_id, p_actor_token, 'cancel_sale') then
    return jsonb_build_object('ok', false, 'sale_id', p_sale_id, 'reference', '', 'restocked_lines', 0,
                              'error', 'Seul le boss peut annuler une vente');
  end if;

  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Vente introuvable';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'Vente déjà annulée';
  end if;

  update sales
    set status        = 'cancelled',
        cancelled_at  = now(),
        cancelled_by  = p_cancelled_by,
        cancel_reason = p_reason
    where id = p_sale_id;

  for v_item in select * from sale_items where sale_id = p_sale_id and restocked = false
  loop
    v_count := v_count + 1;
    update products
      set stock_qty = round(coalesce(stock_qty, 0) + v_item.stock_decrement, 3),
          updated_at = now()
      where id = v_item.product_id;

    update sale_items set restocked = true where id = v_item.id;

    insert into stock_movements (product_id, sale_id, reason, delta, unit, quantity, created_by, note)
    values (v_item.product_id, p_sale_id, 'cancellation', round(v_item.stock_decrement, 3),
            v_item.unit, v_item.quantity, p_cancelled_by, 'Annulation vente ' || v_sale.reference);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'sale_id', p_sale_id,
    'reference', v_sale.reference,
    'restocked_lines', v_count
  );
end;
$$;

grant execute on function cancel_sale(uuid, text, text, uuid, text) to anon, authenticated;

-- ============ 9. Durcissement RLS =======================================
-- Les écritures directes du client sont fermées ; seules les fonctions
-- SECURITY DEFINER (qui vérifient l'acteur) peuvent écrire. La lecture reste
-- ouverte (données partagées de la quincaillerie).

drop policy if exists "p_ins"   on products;
drop policy if exists "p_upd"   on products;
drop policy if exists "p_del"   on products;

drop policy if exists "psu_ins" on product_sale_units;
drop policy if exists "psu_upd" on product_sale_units;
drop policy if exists "psu_del" on product_sale_units;

drop policy if exists "sm_ins"  on stock_movements;
drop policy if exists "sm_upd"  on stock_movements;
drop policy if exists "sm_del"  on stock_movements;

drop policy if exists "s_ins"   on sales;
drop policy if exists "s_upd"   on sales;
drop policy if exists "s_del"   on sales;

drop policy if exists "si_ins"  on sale_items;
drop policy if exists "si_upd"  on sale_items;
drop policy if exists "si_del"  on sale_items;

drop policy if exists "pay_ins" on payments;
drop policy if exists "pay_upd" on payments;
drop policy if exists "pay_del" on payments;

drop policy if exists "sp_ins"  on sale_payments;
drop policy if exists "sp_upd"  on sale_payments;
drop policy if exists "sp_del"  on sale_payments;
