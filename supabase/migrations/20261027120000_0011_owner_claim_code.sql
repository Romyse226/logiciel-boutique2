/*
# Étape 11 — Reconnaissance durable du patron (code patron)

## Cause réelle du message « Cet appareil n'est pas reconnu comme le gérant du commerce »
`ensure_owner()` (migration 0007) reconnaît l'appareil du patron en comparant
`employees.access_token` de l'unique ligne `is_owner = true` avec le jeton
d'appareil envoyé par le téléphone (`localStorage['quincaillerie.deviceToken']`).

Or ce jeton est RÉGÉNÉRÉ dès qu'il disparaît du stockage local :
nettoyage du cache, « effacer les données du site », navigation privée,
réinstallation de la PWA, ou simplement une autre origine (localhost:5173 vs
localhost:4173, http vs https… : le stockage local est propre à chaque origine
ET à chaque navigateur).

L'index unique partiel `employees_single_owner` interdit par ailleurs une
seconde ligne patron. Conséquence : le patron légitime était définitivement
refusé, sans aucun moyen de reconnaître son nouvel appareil.

## Correctif
1. Nouvelle colonne `employees.owner_claim_code` : un code secret, connu du seul
   patron, qui permet de reconnaître un nouvel appareil.
2. `ensure_owner(p_device_token, p_name, p_phone, p_claim_code)` :
   - jeton d'appareil déjà lié                 -> patron reconnu (inchangé) ;
   - code patron correct                       -> CET appareil est rattaché au
     patron EXISTANT : seul `access_token` est réécrit ; la ligne, les ventes,
     les mouvements de stock, les employés et leurs permissions sont conservés ;
   - sinon                                     -> `is_owner = false`.
3. La création automatique d'un patron au premier lancement est SUPPRIMÉE :
   posséder un nom et un numéro ne suffit plus à devenir patron (protection
   manquante). Le patron est provisionné par ce script (section 4).

## Ce que ce script ne fait PAS
- Il ne supprime AUCUNE donnée : ni ligne `employees`, ni produit, ni vente.
- Il ne réécrit aucun `access_token` existant.
- Il ne modifie ni RLS, ni les employés, ni leurs permissions.
Le script est idempotent : on peut le relancer sans effet de bord.
*/

-- ============ 1. Colonne du code patron =================================

alter table employees add column if not exists owner_claim_code text;

-- ============ 2. Patron existant : lui attribuer un code ================

update employees
   set owner_claim_code =
         upper(substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 12))
 where is_owner = true
   and coalesce(owner_claim_code, '') = '';

-- ============ 3. ensure_owner (4 arguments) =============================
-- Les anciennes signatures sont retirées pour éviter toute ambiguïté :
-- un client qui n'envoie que 3 arguments utilise `p_claim_code = null`.

drop function if exists ensure_owner(text);
drop function if exists ensure_owner(text, text, text);

create or replace function ensure_owner(
  p_device_token text,
  p_name         text default null,
  p_phone        text default null,
  p_claim_code   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_emp employees%rowtype;
begin
  if p_device_token is null or length(p_device_token) < 32 then
    return jsonb_build_object('ok', false, 'is_owner', false, 'error', 'Jeton d''appareil invalide');
  end if;

  select * into v_emp from employees where is_owner = true limit 1;

  if found then
    -- 1) Cet appareil est déjà celui du patron : on met à jour son profil.
    if v_emp.access_token = p_device_token then
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

    -- 2) Nouvel appareil du patron : seul le CODE PATRON l'autorise.
    --    Le nom et le téléphone ne donnent AUCUN droit.
    if p_claim_code is not null
       and v_emp.owner_claim_code is not null
       and upper(btrim(p_claim_code)) = v_emp.owner_claim_code then
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
        'status', v_emp.status
      );
    end if;

    -- 3) Ni jeton lié, ni code patron valide.
    return jsonb_build_object('ok', true, 'is_owner', false, 'claim_required', true);
  end if;

  -- Aucun patron configuré : la création depuis l'application n'est plus
  -- possible (un nom + un numéro ne doivent pas suffire). Voir section 4.
  return jsonb_build_object(
    'ok', false, 'is_owner', false,
    'error', U&'Aucun patron n''est configur\00e9 sur ce serveur.'
  );
end;
$fn$;

grant execute on function ensure_owner(text, text, text, text) to anon, authenticated;

-- ============ 4. Provisionnement du patron (idempotent) =================
-- Si (et seulement si) aucun patron n'existe, on en crée un avec un code.
-- Sur votre base le patron existe déjà : cette section ne fait rien.

insert into employees (name, phone, status, can_edit_catalog, can_add_products,
                       access_token, is_owner, owner_claim_code)
select 'Boss', null, 'active', true, true,
       replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), true,
       upper(substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 12))
where not exists (select 1 from employees where is_owner = true);

-- ============ 5. Relecture du schéma par PostgREST ======================

notify pgrst, 'reload schema';

-- ============ 6. CODE PATRON (lisez cette dernière ligne) ===============
-- La valeur ci-dessous est le code du patron. Il est demandé UNE SEULE FOIS,
-- sur chaque nouvel appareil du patron. Relancez cette requête pour le relire.

select 'CODE PATRON = ' || owner_claim_code as a_noter, name, owner_claim_code
  from employees
 where is_owner = true;
