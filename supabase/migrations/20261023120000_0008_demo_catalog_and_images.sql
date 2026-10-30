/*
# 0008 — Catalogue de démonstration (10 produits) + 8 catégories + support « image_key »

Objectifs :
  1. Ajouter la colonne `products.image_key` (nullable, clé d'image stable, distincte
     de l'identifiant du produit et de la future photo personnalisée `image_url`).
  2. Réparer l'encodage des unités de vente corrompues (`DÃ©tail` -> `Détail`),
     cause racine du bug « le prix de détail ne s'enregistre pas ».
  3. Remplacer les catégories par les 8 catégories demandées.
  4. Retirer l'ancien catalogue de démonstration (archivage NON destructif : les
     ventes, crédits, historiques et mouvements de stock sont conservés).
  5. Insérer les 10 produits de démonstration + leurs prix Gros / Détail.
  6. Réécrire `save_product()` avec des unités en ASCII échappé (impossible à
     corrompre au copier-coller) + nettoyage des anciennes unités non canoniques.

IMPORTANT : ce fichier ne contient QUE des caractères ASCII. Tous les textes
accentués passent par la syntaxe PostgreSQL `U&'...\00e9...'` (échappement Unicode),
ce qui évite le double-encodage UTF-8 -> latin1 observable sur les données actuelles.

Peut être relancé sans risque (idempotent).
*/

-- ===========================================================================
-- 1. Colonne image_key (non destructif)
-- ===========================================================================
alter table products add column if not exists image_key text;

comment on column products.image_key is
  'Cle d''image stable (ex: maconnerie-ciment-belier). Independante de l''id produit et de la photo du commercant (image_url). Plusieurs produits peuvent partager la meme cle.';

create index if not exists products_image_key_idx on products(image_key);

-- ===========================================================================
-- 2. Reparation de l'encodage des unites de vente
--    Ancienne valeur corrompue : D + A-tilde + (c) + tail  (UTF-8 relu en latin1)
--    Valeur cible : U&'D\00e9tail'  =  Detail avec accent aigu
-- ===========================================================================
-- Supprime d'abord un eventuel doublon corrompu quand la ligne canonique
-- existe deja pour le meme produit (evite une violation d'unicite).
delete from product_sale_units
 where unit <> U&'D\00e9tail'
   and lower(unit) like '%tail%'
   and exists (select 1 from product_sale_units k
                where k.product_id = product_sale_units.product_id
                  and k.unit = U&'D\00e9tail');

update product_sale_units
   set unit = U&'D\00e9tail'
 where unit <> U&'D\00e9tail'
   and lower(unit) like '%tail%';

-- ===========================================================================
-- 3. Les 8 categories demandees
-- ===========================================================================
insert into product_categories (slug, name, color, sort_order)
values
  ('maconnerie',      U&'Ma\00e7onnerie & Ciment',                           'orange',    1),
  ('quincaillerie',   'Quincaillerie & Clous',                               'slate',     2),
  ('plomberie',       'Plomberie & Eau',                                     'blue',      3),
  ('electricite',     U&'\00c9lectricit\00e9',                               'yellow',    4),
  ('peinture',        U&'Peinture & \00c9tanch\00e9it\00e9',                 'violet',    5),
  ('menuiserie',      U&'Menuiserie & S\00e9curit\00e9 de Porte',            'red',       6),
  ('electroportatif', U&'Outillage \00c9lectroportatif & Machines Chantier', 'cyan',      7),
  ('luminaires',      U&'Luminaires & D\00e9coration',                       'amber',     8)
on conflict (slug) do update
  set name = excluded.name,
      color = excluded.color,
      sort_order = excluded.sort_order;

-- Retirer les categories obsoletes (les produits y faisant reference passent a
-- category_id = null via la contrainte existing "on delete set null").
delete from product_categories
 where slug not in ('maconnerie', 'quincaillerie', 'plomberie', 'electricite',
                    'peinture', 'menuiserie', 'electroportatif', 'luminaires');

-- ===========================================================================
-- 4. Retrait de l'ancien catalogue (archivage, NON destructif)
--    Aucune ligne n'est supprimee : les ventes / credits / historiques
--    continuent de fonctionner (sale_items conserve le nom du produit).
-- ===========================================================================
update products
   set is_archived = true,
       is_active   = false,
       updated_at  = now()
 where is_archived = false;

-- ===========================================================================
-- 5. Les 10 produits de demonstration
--    Identifiant d'image (image_key) = cle stable, jamais regeneree.
-- ===========================================================================
with demo(key, name, cat, unit, gros, detail, qty) as (
  values
    ('maconnerie-ciment-belier',       U&'Ciment CPJ 32.5 / 42.5 (B\00e9lier)',        'maconnerie',    U&'sac',     90000::numeric,  4500::numeric, 60::numeric),
    ('maconnerie-fer-beton-ha-8',      U&'Fer \00e0 b\00e9ton HA \00d88 (Barre 12m)',  'maconnerie',    'barre',     34000::numeric,  3500::numeric, 40::numeric),
    ('maconnerie-fer-beton-ha-10',     U&'Fer \00e0 b\00e9ton HA \00d810 (Barre 12m)', 'maconnerie',    'barre',     54000::numeric,  5500::numeric, 30::numeric),
    ('quincaillerie-pointe-n4',        U&'Pointe N\00b04',                             'quincaillerie', 'kg',        26000::numeric,  1100::numeric, 25::numeric),
    ('plomberie-tuyau-pvc-100',        U&'Tuyau PVC \00c9vacuation \00d8100 (4m)',      'plomberie',     'barre',     16000::numeric,  3500::numeric, 20::numeric),
    ('electricite-fil-15',             U&'Fil \00e9lectrique 1.5 mm\00b2 (Rouleau 100m)', 'electricite', 'rouleau', 62500::numeric, 13500::numeric, 15::numeric),
    ('electricite-fil-25',             U&'Fil \00e9lectrique 2.5 mm\00b2 (Rouleau 100m)', 'electricite', 'rouleau', 95000::numeric, 20000::numeric, 10::numeric),
    ('peinture-vinylique-latex-20l',   U&'Peinture Vinylique / Latex (Bidon 20L)',    'peinture',      'bidon',     75000::numeric, 16000::numeric, 12::numeric),
    ('plomberie-colle-pvc-125g',       U&'Colle PVC (Tangit / Tube 125g)',             'plomberie',     'tube',      28800::numeric,  1500::numeric, 30::numeric),
    ('securite-cadenas-40mm',          U&'Cadenas simple (40 mm)',                     'menuiserie',    U&'unit\00e9', 13500::numeric, 1500::numeric, 40::numeric)
)
insert into products (id, category_id, name, image_key, stock_unit, stock_qty,
                      low_stock_threshold, is_active, is_archived)
select gen_random_uuid(), c.id, d.name, d.key, d.unit, d.qty, 0, true, false
  from demo d
  join product_categories c on c.slug = d.cat
 where not exists (select 1 from products p where p.image_key = d.key);

-- Prix Gros / Detail des 10 produits (relies par image_key).
with prices(key, unit, price, is_default) as (
  values
    ('maconnerie-ciment-belier',     'Gros',               90000::numeric, false),
    ('maconnerie-ciment-belier',     U&'D\00e9tail',        4500::numeric, true),
    ('maconnerie-fer-beton-ha-8',    'Gros',               34000::numeric, false),
    ('maconnerie-fer-beton-ha-8',    U&'D\00e9tail',        3500::numeric, true),
    ('maconnerie-fer-beton-ha-10',   'Gros',               54000::numeric, false),
    ('maconnerie-fer-beton-ha-10',   U&'D\00e9tail',        5500::numeric, true),
    ('quincaillerie-pointe-n4',      'Gros',               26000::numeric, false),
    ('quincaillerie-pointe-n4',      U&'D\00e9tail',        1100::numeric, true),
    ('plomberie-tuyau-pvc-100',      'Gros',               16000::numeric, false),
    ('plomberie-tuyau-pvc-100',      U&'D\00e9tail',        3500::numeric, true),
    ('electricite-fil-15',           'Gros',               62500::numeric, false),
    ('electricite-fil-15',           U&'D\00e9tail',       13500::numeric, true),
    ('electricite-fil-25',           'Gros',               95000::numeric, false),
    ('electricite-fil-25',           U&'D\00e9tail',       20000::numeric, true),
    ('peinture-vinylique-latex-20l', 'Gros',               75000::numeric, false),
    ('peinture-vinylique-latex-20l', U&'D\00e9tail',       16000::numeric, true),
    ('plomberie-colle-pvc-125g',     'Gros',               28800::numeric, false),
    ('plomberie-colle-pvc-125g',     U&'D\00e9tail',        1500::numeric, true),
    ('securite-cadenas-40mm',        'Gros',               13500::numeric, false),
    ('securite-cadenas-40mm',        U&'D\00e9tail',        1500::numeric, true)
)
insert into product_sale_units (product_id, unit, price, factor_to_stock, is_default, allow_decimal)
select p.id, pr.unit, pr.price, 1, pr.is_default, false
  from prices pr
  join products p on p.image_key = pr.key
on conflict (product_id, unit) do update
  set price           = excluded.price,
      factor_to_stock = 1,
      is_default      = excluded.is_default,
      allow_decimal   = false;

-- ===========================================================================
-- 6. save_product() : unites en ASCII echappe + nettoyage des unites obsoletes
--    (corrige definitivement l'enregistrement du prix de Detail)
-- ===========================================================================
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
    update products set is_archived = true, updated_at = now() where id = p_product_id;
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
