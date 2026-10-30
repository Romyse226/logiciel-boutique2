/*
# Étape 10 — L'archivage d'un produit détache sa photo (référence en base)

## Cause réelle du bug « la photo n'est pas supprimée de Supabase »
`save_product()` (dernière version : migration 0008) archivait un produit avec
`update products set is_archived = true, ...` SANS toucher `image_url`.
Le client tentait ensuite d'effacer la référence par un
`update products set image_url = null` en écriture DIRECTE. Or la migration
0006 a retiré les politiques RLS d'écriture permissives (`p_ins`/`p_upd`/`p_del`
sur `products`) : l'écriture directe est donc refusée par la base. PostgREST ne
renvoie pas d'erreur bruyante (HTTP 200) mais **zéro ligne mise à jour**, et le
code client ignorait ce résultat. La ligne archivée continuait donc de pointer
vers un fichier supprimé du stockage (référence orpheline).

## Correction
La seule voie d'écriture autorisée est la fonction SECURITY DEFINER
`save_product()`. Sa branche `archive` détache désormais elle-même la photo
(`image_url = null`), de façon atomique, avant de retourner.

## Ce que cette migration ne fait PAS
- Elle ne supprime AUCUN fichier du stockage : la suppression du fichier reste
  faite par l'application, après vérification qu'aucun autre produit ne partage
  la même photo.
- Elle ne supprime ni ne modifie aucune donnée existante.
*/

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
as $fn$
declare
  v_prod    products%rowtype;
  v_actor   text;
  v_id      uuid;
  v_delta   numeric(14,3);
  v_note    text;
begin
  if p_actor_id is null then
    return jsonb_build_object('ok', false, 'error', 'Action non autorisee');
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
    -- Detachement de la photo des l'archivage : la base ne doit plus pointer
    -- vers un fichier qui sera retire du stockage juste apres.
    update products
       set is_archived = true,
           image_url   = null,
           updated_at  = now()
     where id = p_product_id;
    return jsonb_build_object('ok', true, 'product_id', p_product_id, 'archived', true);
  end if;

  -- ---------------- Creation ----------------
  if p_mode = 'create' then
    if not employee_can(p_actor_id, p_actor_token, 'add_products') then
      return jsonb_build_object('ok', false, 'error', 'Demande au boss de t''autoriser avant d''effectuer cette action');
    end if;
    if p_name is null or btrim(p_name) = '' then
      return jsonb_build_object('ok', false, 'error', 'Le nom du produit est obligatoire');
    end if;

    -- Au moins un prix doit etre renseigne (gros, detail, ou les deux).
    if coalesce(p_price_gros, 0) <= 0 and coalesce(p_price_detail, 0) <= 0 then
      return jsonb_build_object('ok', false, 'error', 'Renseignez au moins un prix');
    end if;

    v_id := coalesce(p_product_id, gen_random_uuid());

    -- Rejeu hors-ligne : le produit existe deja, on ne fait rien.
    if exists (select 1 from products where id = v_id) then
      return jsonb_build_object('ok', true, 'product_id', v_id, 'replayed', true);
    end if;

    insert into products (id, category_id, name, image_url, stock_unit, stock_qty,
                          low_stock_threshold, is_active, is_archived)
    values (v_id, p_category_id, btrim(p_name), p_image_url, U&'unit\00e9', p_stock_qty,
            coalesce(p_low_stock_threshold, 0), true, false);

    -- Nettoyage d'eventuelles unites non canoniques, puis ecriture des deux unites.
    delete from product_sale_units
     where product_id = v_id
       and unit not in ('Gros', U&'D\00e9tail');

    insert into product_sale_units (product_id, unit, price, factor_to_stock, is_default, allow_decimal)
    values (v_id, 'Gros',            coalesce(p_price_gros, 0),   1, false, false),
           (v_id, U&'D\00e9tail',    coalesce(p_price_detail, 0), 1, true,  false)
    on conflict (product_id, unit) do update
      set price = excluded.price, factor_to_stock = 1,
          is_default = excluded.is_default, allow_decimal = false;

    if coalesce(p_stock_qty, 0) <> 0 then
      insert into stock_movements (product_id, reason, delta, unit, quantity, note, created_by, idempotency_key)
      values (v_id, 'adjustment', coalesce(p_stock_qty, 0), U&'unit\00e9', abs(coalesce(p_stock_qty, 0)),
              U&'Cr\00e9ation du produit', v_actor, p_idempotency_key);
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

    -- Rejeu hors-ligne d'un ajustement de stock : deja applique.
    if p_idempotency_key is not null
       and exists (select 1 from stock_movements where idempotency_key = p_idempotency_key) then
      return jsonb_build_object('ok', true, 'product_id', p_product_id, 'replayed', true);
    end if;

    -- Au moins un prix doit etre renseigne (gros, detail, ou les deux).
    if coalesce(p_price_gros, 0) <= 0 and coalesce(p_price_detail, 0) <= 0 then
      return jsonb_build_object('ok', false, 'error', 'Renseignez au moins un prix');
    end if;

    update products set
      name        = coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_prod.name),
      image_url   = coalesce(p_image_url, v_prod.image_url),
      stock_qty   = p_stock_qty,
      updated_at  = now()
    where id = p_product_id;

    -- Nettoyage d'eventuelles unites non canoniques, puis ecriture des deux unites.
    delete from product_sale_units
     where product_id = p_product_id
       and unit not in ('Gros', U&'D\00e9tail');

    insert into product_sale_units (product_id, unit, price, factor_to_stock, is_default, allow_decimal)
    values (p_product_id, 'Gros',         coalesce(p_price_gros, 0),   1, false, false),
           (p_product_id, U&'D\00e9tail', coalesce(p_price_detail, 0), 1, true,  false)
    on conflict (product_id, unit) do update
      set price = excluded.price, factor_to_stock = 1,
          is_default = excluded.is_default, allow_decimal = false;

    -- Trace l'ajustement de stock dans le journal (avec l'employe responsable).
    if p_stock_qty is distinct from v_prod.stock_qty then
      v_delta := coalesce(p_stock_qty, 0) - coalesce(v_prod.stock_qty, 0);
      v_note  := case when v_prod.stock_qty is null then 'Stock configure' else 'Modification du stock' end;
      if v_delta <> 0 then
        insert into stock_movements (product_id, reason, delta, unit, quantity, note, created_by, idempotency_key)
        values (p_product_id, 'adjustment', v_delta, v_prod.stock_unit, abs(v_delta),
                v_note, v_actor, p_idempotency_key);
      end if;
    end if;

    return jsonb_build_object('ok', true, 'product_id', p_product_id, 'updated', true);
  end if;

  return jsonb_build_object('ok', false, 'error', 'Operation inconnue');
end;
$fn$;

grant execute on function save_product(uuid, text, text, uuid, text, uuid, text, numeric, numeric, numeric, numeric, text)
  to anon, authenticated;
