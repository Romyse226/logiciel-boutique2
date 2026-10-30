-- ===========================================================================
-- catalogue.generated.sql -- FICHIER GENERE AUTOMATIQUEMENT, NE PAS MODIFIER
--
-- Source   : catalogue.json (fichier unique de gestion du catalogue)
-- Regenerer: npm run catalogue:sync
-- Version  : v2
--
-- PREREQUIS : migration 0008 (colonne products.image_key) deja appliquee.
--
-- Proprietes :
--   * IDEMPOTENT  : peut etre relance autant de fois que necessaire ;
--   * NON DESTRUCTIF : aucune vente, aucun stock, aucun historique n'est touche.
--     Le stock reel du commercant (stock_qty) et sa photo personnalisee
--     (image_url) ne sont JAMAIS modifies par ce script ;
--   * ASCII pur : les accents passent par U&'...\00e9...' (aucune corruption
--     possible au copier-coller dans l'editeur SQL de Supabase).
-- ===========================================================================

-- ===========================================================================
-- 1. Les categories (mises a jour par identifiant stable "slug")
-- ===========================================================================
insert into product_categories (slug, name, color, sort_order)
values
  ('maconnerie', U&'Ma\00e7onnerie & Ciment', 'orange', 1),
  ('quincaillerie', 'Quincaillerie & Clous', 'slate', 2),
  ('plomberie', 'Plomberie & Eau', 'blue', 3),
  ('electricite', U&'\00c9lectricit\00e9', 'yellow', 4),
  ('peinture', U&'Peinture & \00c9tanch\00e9it\00e9', 'violet', 5),
  ('menuiserie', U&'Menuiserie & S\00e9curit\00e9 de Porte', 'red', 6),
  ('electroportatif', U&'Outillage \00c9lectroportatif & Machines Chantier', 'cyan', 7),
  ('luminaires', U&'Luminaires & D\00e9coration', 'amber', 8)
on conflict (slug) do update
  set name = excluded.name,
      color = excluded.color,
      sort_order = excluded.sort_order;

-- Supprime uniquement les categories hors catalogue (les produits y faisant
-- reference passent a category_id = null, aucun produit n'est supprime).
delete from product_categories
 where slug not in ('maconnerie', 'quincaillerie', 'plomberie', 'electricite', 'peinture', 'menuiserie', 'electroportatif', 'luminaires');

-- ===========================================================================
-- 2. Les produits du catalogue (identifies par leur image_key stable)
--    - mise a jour du nom / categorie / unite de stock des produits connus ;
--    - insertion des produits manquants.
--    stock_qty et image_url (stock et photo du commercant) restent INTACTS.
-- ===========================================================================
update products p
   set name       = d.name,
       category_id = c.id,
       stock_unit  = d.unit,
       is_active   = true,
       is_archived = false,
       updated_at  = now()
  from (values
    (U&'Ciment CPJ 32.5 / 42.5 (B\00e9lier)', 'maconnerie-ciment-belier', 'sac', 'maconnerie'),
    (U&'Fer \00e0 b\00e9ton HA \00d88 (Barre 12m)', 'maconnerie-fer-beton-ha-8', 'barre', 'maconnerie'),
    (U&'Pointe N\00b04', 'quincaillerie-pointe-n4', 'kg', 'quincaillerie'),
    (U&'Tuyau PVC \00c9vacuation \00d8100 (4m)', 'plomberie-tuyau-pvc-100', 'barre', 'plomberie'),
    (U&'Fil \00e9lectrique 1.5 mm\00b2 (Rouleau 100m)', 'electricite-fil-15', 'rouleau', 'electricite'),
    ('Peinture Vinylique / Latex (Bidon 20L)', 'peinture-vinylique-latex-20l', 'bidon', 'peinture'),
    ('Colle PVC (Tangit / Tube 125g)', 'plomberie-colle-pvc-125g', 'tube', 'plomberie'),
    ('Cadenas simple (40 mm)', 'securite-cadenas-40mm', U&'unit\00e9', 'menuiserie'),
    (U&'Brouette renforc\00e9e de chantier', 'maconnerie-brouette-renforcee', U&'unit\00e9', 'maconnerie'),
    ('Ampoule LED 12W (E27)', 'electricite-ampoule-led-12w', U&'unit\00e9', 'electricite')
  ) as d(name, image_key, unit, cat)
  join product_categories c on c.slug = d.cat
 where p.image_key = d.image_key;

insert into products (id, category_id, name, image_key, stock_unit, stock_qty,
                      low_stock_threshold, is_active, is_archived)
select gen_random_uuid(), c.id, d.name, d.image_key, d.unit, 0, 0, true, false
  from (values
    (U&'Ciment CPJ 32.5 / 42.5 (B\00e9lier)', 'maconnerie-ciment-belier', 'sac', 'maconnerie'),
    (U&'Fer \00e0 b\00e9ton HA \00d88 (Barre 12m)', 'maconnerie-fer-beton-ha-8', 'barre', 'maconnerie'),
    (U&'Pointe N\00b04', 'quincaillerie-pointe-n4', 'kg', 'quincaillerie'),
    (U&'Tuyau PVC \00c9vacuation \00d8100 (4m)', 'plomberie-tuyau-pvc-100', 'barre', 'plomberie'),
    (U&'Fil \00e9lectrique 1.5 mm\00b2 (Rouleau 100m)', 'electricite-fil-15', 'rouleau', 'electricite'),
    ('Peinture Vinylique / Latex (Bidon 20L)', 'peinture-vinylique-latex-20l', 'bidon', 'peinture'),
    ('Colle PVC (Tangit / Tube 125g)', 'plomberie-colle-pvc-125g', 'tube', 'plomberie'),
    ('Cadenas simple (40 mm)', 'securite-cadenas-40mm', U&'unit\00e9', 'menuiserie'),
    (U&'Brouette renforc\00e9e de chantier', 'maconnerie-brouette-renforcee', U&'unit\00e9', 'maconnerie'),
    ('Ampoule LED 12W (E27)', 'electricite-ampoule-led-12w', U&'unit\00e9', 'electricite')
  ) as d(name, image_key, unit, cat)
  join product_categories c on c.slug = d.cat
 where not exists (select 1 from products p where p.image_key = d.image_key);

-- ===========================================================================
-- 3. Les prix Gros / Detail (unis par (produit, unite))
-- ===========================================================================
with data(image_key, unit, price, is_default) as (
  values
    ('maconnerie-ciment-belier', 'Gros', 90000, false),
    ('maconnerie-ciment-belier', U&'D\00e9tail', 4500, true),
    ('maconnerie-fer-beton-ha-8', 'Gros', 34000, false),
    ('maconnerie-fer-beton-ha-8', U&'D\00e9tail', 3500, true),
    ('quincaillerie-pointe-n4', 'Gros', 26000, false),
    ('quincaillerie-pointe-n4', U&'D\00e9tail', 1100, true),
    ('plomberie-tuyau-pvc-100', 'Gros', 16000, false),
    ('plomberie-tuyau-pvc-100', U&'D\00e9tail', 3500, true),
    ('electricite-fil-15', 'Gros', 62500, false),
    ('electricite-fil-15', U&'D\00e9tail', 13500, true),
    ('peinture-vinylique-latex-20l', 'Gros', 75000, false),
    ('peinture-vinylique-latex-20l', U&'D\00e9tail', 16000, true),
    ('plomberie-colle-pvc-125g', 'Gros', 28800, false),
    ('plomberie-colle-pvc-125g', U&'D\00e9tail', 1500, true),
    ('securite-cadenas-40mm', 'Gros', 13500, false),
    ('securite-cadenas-40mm', U&'D\00e9tail', 1500, true),
    ('maconnerie-brouette-renforcee', 'Gros', 54000, false),
    ('maconnerie-brouette-renforcee', U&'D\00e9tail', 19000, true),
    ('electricite-ampoule-led-12w', 'Gros', 6000, false),
    ('electricite-ampoule-led-12w', U&'D\00e9tail', 800, true)
)
insert into product_sale_units (product_id, unit, price, factor_to_stock, is_default, allow_decimal)
select p.id, d.unit, d.price, 1, d.is_default, false
  from data d
  join products p on p.image_key = d.image_key
on conflict (product_id, unit) do update
  set price           = excluded.price,
      factor_to_stock = 1,
      is_default      = excluded.is_default,
      allow_decimal   = false;

-- Nettoyage d'eventuelles unites non canoniques sur les produits du catalogue.
delete from product_sale_units
 where unit not in ('Gros', U&'D\00e9tail')
   and product_id in (select id from products where image_key in ('maconnerie-ciment-belier', 'maconnerie-fer-beton-ha-8', 'quincaillerie-pointe-n4', 'plomberie-tuyau-pvc-100', 'electricite-fil-15', 'peinture-vinylique-latex-20l', 'plomberie-colle-pvc-125g', 'securite-cadenas-40mm', 'maconnerie-brouette-renforcee', 'electricite-ampoule-led-12w'));

-- ===========================================================================
-- 4. Verification (facultatif) : liste les produits du catalogue et leurs prix
-- ===========================================================================
-- select p.name, p.image_key, p.stock_unit,
--        max(case when u.unit = 'Gros' then u.price end) as prix_gros,
--        max(case when u.unit = U&'D\00e9tail' then u.price end) as prix_detail
--   from products p
--   left join product_sale_units u on u.product_id = p.id
--  where p.image_key in ('maconnerie-ciment-belier', 'maconnerie-fer-beton-ha-8', 'quincaillerie-pointe-n4', 'plomberie-tuyau-pvc-100', 'electricite-fil-15', 'peinture-vinylique-latex-20l', 'plomberie-colle-pvc-125g', 'securite-cadenas-40mm', 'maconnerie-brouette-renforcee', 'electricite-ampoule-led-12w')
--  group by p.name, p.image_key, p.stock_unit
--  order by p.name;
