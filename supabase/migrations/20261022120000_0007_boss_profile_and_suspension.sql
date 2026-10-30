/*
# Étape 6 — Profil du boss (nom + téléphone) et suspension nominative

Objectif : permettre à chaque boss de renseigner son nom et son numéro de
téléphone (page d'accueil / onboarding), et tracer QUI a suspendu un employé.

## 1. Colonne `employees.suspended_by`
Mémorise le nom du boss qui a suspendu l'accès. Elle est renseignée au moment
de la suspension et vidée lors d'une réactivation.

## 2. `ensure_owner(p_device_token, p_name, p_phone)`
Réclame (ou retrouve) l'appareil du boss. Le nom et le téléphone saisis à
l'inscription sont enregistrés ; si le boss existe déjà sur cet appareil, son
nom/téléphone sont mis à jour. Sans nom, on retombe sur « Boss ».

## 3. `update_employee(...)`
Enregistre `suspended_by` (nom du boss acteur) lorsque le statut passe à
« suspended », et le remet à NULL sinon.

## 4. `employee_state(...)` et `list_employees(...)`
Exposent `suspended_by` au client pour afficher le message de suspension.

Aucune donnée existante n'est supprimée : le script est idempotent.
*/

-- ============ 1. Colonne suspended_by ===================================

alter table employees add column if not exists suspended_by text;

-- ============ 2. Boss : réclamation de l'appareil (nom + téléphone) =====

drop function if exists ensure_owner(text);

create or replace function ensure_owner(
  p_device_token text,
  p_name         text default null,
  p_phone        text default null
) returns jsonb
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
      -- Le boss existe déjà sur cet appareil : on met à jour son profil.
      update employees set
        name       = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
        phone      = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone),
        updated_at = now()
      where id = v_emp.id
      returning * into v_emp;
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
  values (
    coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Boss'),
    nullif(btrim(coalesce(p_phone, '')), ''),
    'active', true, true, p_device_token, true
  )
  returning * into v_emp;

  return jsonb_build_object(
    'ok', true, 'is_owner', true,
    'employee_id', v_emp.id, 'name', v_emp.name, 'token', v_emp.access_token,
    'status', v_emp.status
  );
end;
$$;

grant execute on function ensure_owner(text, text, text) to anon, authenticated;

-- ============ 3. list_employees : expose suspended_by ===================

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
           access_token, suspended_by, created_at
    from employees
    where is_owner = false
    order by created_at asc
  ) t;

  return jsonb_build_object('ok', true, 'employees', v_rows);
end;
$$;

-- ============ 4. update_employee : trace le boss qui suspend ============

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
  v_emp   employees%rowtype;
  v_actor text;
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

  v_actor := employee_name(p_actor_id, p_actor_token);

  update employees set
    status           = coalesce(p_status, v_emp.status),
    can_edit_catalog = coalesce(p_can_edit, v_emp.can_edit_catalog),
    can_add_products = coalesce(p_can_add, v_emp.can_add_products),
    suspended_by     = case
                         when coalesce(p_status, v_emp.status) = 'suspended'
                           then coalesce(v_actor, v_emp.suspended_by)
                         else null
                       end,
    updated_at       = now()
  where id = p_employee_id
  returning * into v_emp;

  return jsonb_build_object(
    'ok', true,
    'employee', jsonb_build_object(
      'id', v_emp.id, 'name', v_emp.name, 'phone', v_emp.phone,
      'status', v_emp.status, 'can_edit_catalog', v_emp.can_edit_catalog,
      'can_add_products', v_emp.can_add_products, 'access_token', v_emp.access_token,
      'suspended_by', v_emp.suspended_by
    )
  );
end;
$$;

-- ============ 5. employee_state : expose suspended_by ===================

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
    'suspended_by', v_emp.suspended_by,
    'can_edit_catalog', v_emp.can_edit_catalog,
    'can_add_products', v_emp.can_add_products
  );
end;
$$;
