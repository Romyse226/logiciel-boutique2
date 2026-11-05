/*
# Étape 12 — Code secret personnel du patron (hashé)

Objectif : remplacer le « code patron » (12 caractères, stocké EN CLAIR) par un
CODE SECRET PERSONNEL choisi par le patron, conservé UNIQUEMENT sous forme de
hash (bcrypt via pgcrypto). Aucun code n'est jamais stocké en clair.

Comportement attendu :
- Première configuration d'un appareil : le patron saisit nom + téléphone +
  code secret -> la ligne patron est créée (ou rattachée) avec le hash du code.
- Appareil déjà reconnu (jeton d'appareil lié) : aucun code n'est demandé.
- Session perdue / nouvel appareil : le code secret est la seule preuve acceptée.
- Code oublié : le gérant génère un CODE TEMPORAIRE depuis Supabase (voir la
  section « EN CAS DE CODE OUBLIÉ » en fin de fichier) ; le patron saisit ce code
  temporaire puis choisit un nouveau code secret. Le code temporaire devient
  inutilisable aussitôt (son hash est effacé).

Ce script ne supprime AUCUNE donnée métier (ventes, produits, employés).
Il est idempotent : on peut le relancer sans effet de bord.
*/

-- ============ 1. Colonnes de hachage =====================================
alter table employees add column if not exists owner_secret_hash text;
alter table employees add column if not exists owner_temp_hash   text;

-- Les anciens codes « patron » en clair sont effacés (remplacés par le hash
-- du code secret choisi par le patron).
update employees
   set owner_claim_code = null
 where is_owner = true
   and owner_claim_code is not null;

-- ============ 2. ensure_owner (4 arguments) ==============================
-- `p_secret` = code secret du patron (jamais conservé en clair).
drop function if exists ensure_owner(text, text, text, text);

create or replace function ensure_owner(
  p_device_token text,
  p_name         text default null,
  p_phone        text default null,
  p_secret       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_emp    employees%rowtype;
  v_secret text := nullif(btrim(coalesce(p_secret, '')), '');
begin
  if p_device_token is null or length(p_device_token) < 32 then
    return jsonb_build_object('ok', false, 'is_owner', false, 'error', 'Jeton d''appareil invalide');
  end if;

  select * into v_emp from employees where is_owner = true limit 1;

  -- (A) Aucun patron : première configuration -> on le crée ici.
  if not found then
    if v_secret is null or length(v_secret) < 4 then
      return jsonb_build_object('ok', false, 'is_owner', false,
        'error', U&'Choisis un code secret d''au moins 4 chiffres.');
    end if;

    insert into employees (name, phone, status, can_edit_catalog, can_add_products,
                           access_token, is_owner, owner_secret_hash)
    values (coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Boss'),
            nullif(btrim(coalesce(p_phone, '')), ''),
            'active', true, true,
            p_device_token, true,
            crypt(v_secret, gen_salt('bf')))
    returning * into v_emp;

    return jsonb_build_object(
      'ok', true, 'is_owner', true,
      'employee_id', v_emp.id, 'name', v_emp.name, 'token', v_emp.access_token,
      'status', v_emp.status, 'needs_secret', false);
  end if;

  -- (B) Cet appareil est déjà celui du patron : on met à jour le profil.
  --     S'il n'a pas encore de code secret, celui saisi ici le définit
  --     (unique chemin pour une base migrée depuis l'ancien « code patron »).
  if v_emp.access_token = p_device_token then
    update employees set
      name       = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
      phone      = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone),
      owner_secret_hash = case
        when v_emp.owner_secret_hash is null and v_secret is not null
          then crypt(v_secret, gen_salt('bf'))
        else v_emp.owner_secret_hash
      end,
      updated_at = now()
    where id = v_emp.id
    returning * into v_emp;

    return jsonb_build_object(
      'ok', true, 'is_owner', true,
      'employee_id', v_emp.id, 'name', v_emp.name, 'token', v_emp.access_token,
      'status', v_emp.status,
      'needs_secret', v_emp.owner_secret_hash is null);
  end if;

  -- (C) Nouvel appareil : seul le code secret du patron l'autorise.
  --     Le nom et le téléphone ne donnent AUCUN droit.
  if v_secret is not null
     and v_emp.owner_secret_hash is not null
     and crypt(v_secret, v_emp.owner_secret_hash) = v_emp.owner_secret_hash then
    update employees set
      access_token = p_device_token,
      name         = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
      phone        = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone),
      updated_at   = now()
    where id = v_emp.id
    returning * into v_emp;

    return jsonb_build_object(
      'ok', true, 'is_owner', true,
      'employee_id', v_emp.id, 'name', v_emp.name, 'token', v_emp.access_token,
      'status', v_emp.status, 'needs_secret', false);
  end if;

  -- (D) Ni appareil reconnu, ni code secret valide.
  return jsonb_build_object('ok', true, 'is_owner', false, 'claim_required', true);
end;
$fn$;

grant execute on function ensure_owner(text, text, text, text) to anon, authenticated;

-- ============ 3. reset_owner_secret =====================================
-- « Code oublié » : vérifie le code TEMPORAIRE puis enregistre le NOUVEAU code
-- secret. Le code temporaire est effacé : il devient inutilisable.
create or replace function reset_owner_secret(
  p_device_token text,
  p_temp_code    text,
  p_new_secret   text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_emp  employees%rowtype;
  v_temp text := btrim(coalesce(p_temp_code, ''));
  v_new  text := nullif(btrim(coalesce(p_new_secret, '')), '');
begin
  if p_device_token is null or length(p_device_token) < 32 then
    return jsonb_build_object('ok', false, 'error', 'Jeton d''appareil invalide');
  end if;
  if v_new is null or length(v_new) < 4 then
    return jsonb_build_object('ok', false, 'error', U&'Choisis un code secret d''au moins 4 chiffres.');
  end if;

  select * into v_emp from employees where is_owner = true limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', U&'Aucun patron n''est configur\00e9.');
  end if;

  if v_emp.owner_temp_hash is null
     or crypt(v_temp, v_emp.owner_temp_hash) <> v_emp.owner_temp_hash then
    return jsonb_build_object('ok', false, 'error', 'Code temporaire invalide ou déjà utilisé.');
  end if;

  update employees set
    owner_secret_hash = crypt(v_new, gen_salt('bf')),
    owner_temp_hash   = null,
    access_token      = p_device_token,
    updated_at        = now()
  where id = v_emp.id
  returning * into v_emp;

  return jsonb_build_object(
    'ok', true, 'is_owner', true,
    'employee_id', v_emp.id, 'name', v_emp.name, 'token', v_emp.access_token,
    'status', v_emp.status, 'needs_secret', false);
end;
$fn$;

grant execute on function reset_owner_secret(text, text, text) to anon, authenticated;

-- ============ 4. Relecture du schéma par PostgREST ======================
notify pgrst, 'reload schema';

-- ===========================================================================
-- EN CAS DE CODE OUBLIÉ  (à exécuter À LA DEMANDE, dans le SQL Editor)
--
-- 1. Le patron vous contacte sur WhatsApp (bouton « Code oublié ? »).
-- 2. Après vérification manuelle de son identité, copiez-collez UNIQUEMENT le
--    bloc ci-dessous : il génère un CODE TEMPORAIRE (6 chiffres) et n'enregistre
--    que son hash. Le code en clair n'apparaît qu'une fois, dans le résultat.
-- 3. Communiquez ce code temporaire au patron.
-- 4. Il le saisit dans l'application puis choisit son nouveau code secret.
--    Le code temporaire devient alors inutilisable.
--
-- with nouveau as (
--   select lpad((100000 + floor(random() * 900000))::int::text, 6, '0') as code
-- )
-- update employees
--    set owner_temp_hash = crypt(nouveau.code, gen_salt('bf')),
--        updated_at      = now()
--   from nouveau
--  where is_owner = true
--  returning nouveau.code as code_temporaire_a_communiquer;
-- ===========================================================================
