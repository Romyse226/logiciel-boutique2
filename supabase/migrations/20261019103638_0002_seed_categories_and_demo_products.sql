/*
# Seed: categories + ~30 demo products with sale units

Idempotent: every insert is guarded by `where not exists` so re-running is safe.

## Categories (9)
1. gros-oeuvre      — Gros œuvre & structure        (orange)
2. plomberie        — Plomberie & sanitaires        (blue)
3. electricite      — Électricité & éclairage       (yellow)
4. peinture         — Peinture & étanchéité         (violet)
5. outillage        — Outillage à main & maçon      (turquoise)
6. serrurerie       — Serrurerie, sécurité & EPI    (red)
7. materiel-lourd   — Matériel lourd & chantier     (slate)
8. electroportatif  — Machines électroportatives    (cyan)
9. luminaires       — Luminaires & déco électrique  (amber)

## Products (~30 representative references)
Each product has 1–2 sale units. Prices are explicitly flagged in the app as
"prix indicatif non vérifié" (demo). Stock is left NULL ("À configurer")
except for a few demo products where a small stock is set so the stock-decrement
path can be exercised. Conversions are only set where they are exact
(e.g. 1 carton = 20 pièces). Where no exact conversion is known we leave
factor = 1 (same unit) and the app shows "À configurer" for cross-unit sales.
*/

-- Categories -------------------------------------------------------------
insert into product_categories (slug, name, color, sort_order)
select 'gros-oeuvre',     'Gros œuvre & structure',       'orange', 1
where not exists (select 1 from product_categories where slug = 'gros-oeuvre');
insert into product_categories (slug, name, color, sort_order)
select 'plomberie',       'Plomberie & sanitaires',       'blue',   2
where not exists (select 1 from product_categories where slug = 'plomberie');
insert into product_categories (slug, name, color, sort_order)
select 'electricite',     'Électricité & éclairage',      'yellow', 3
where not exists (select 1 from product_categories where slug = 'electricite');
insert into product_categories (slug, name, color, sort_order)
select 'peinture',        'Peinture & étanchéité',        'violet', 4
where not exists (select 1 from product_categories where slug = 'peinture');
insert into product_categories (slug, name, color, sort_order)
select 'outillage',       'Outillage & maçon',            'turquoise', 5
where not exists (select 1 from product_categories where slug = 'outillage');
insert into product_categories (slug, name, color, sort_order)
select 'serrurerie',      'Serrurerie, sécurité & EPI',   'red',    6
where not exists (select 1 from product_categories where slug = 'serrurerie');
insert into product_categories (slug, name, color, sort_order)
select 'materiel-lourd',  'Matériel lourd & chantier',    'slate',  7
where not exists (select 1 from product_categories where slug = 'materiel-lourd');
insert into product_categories (slug, name, color, sort_order)
select 'electroportatif', 'Machines électroportatives',   'cyan',   8
where not exists (select 1 from product_categories where slug = 'electroportatif');
insert into product_categories (slug, name, color, sort_order)
select 'luminaires',      'Luminaires & déco électrique', 'amber',  9
where not exists (select 1 from product_categories where slug = 'luminaires');

-- Helper: insert a product + its sale units if not present.
-- We do this with plain SQL rows below.

-- ============ Gros œuvre ============
insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Ciment CPJ 32.5 — Bélier (sac 50 kg)', 'sac', 50
from product_categories c where c.slug = 'gros-oeuvre'
and not exists (select 1 from products where name = 'Ciment CPJ 32.5 — Bélier (sac 50 kg)');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Fer à béton HA Ø8 — barre 12 m', 'barre', 120
from product_categories c where c.slug = 'gros-oeuvre'
and not exists (select 1 from products where name = 'Fer à béton HA Ø8 — barre 12 m');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Fil de fer recuit — rouleau 1 kg', 'rouleau', 30
from product_categories c where c.slug = 'gros-oeuvre'
and not exists (select 1 from products where name = 'Fil de fer recuit — rouleau 1 kg');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Pointes ordinaires 70 mm — paquet 1 kg', 'paquet', 25
from product_categories c where c.slug = 'gros-oeuvre'
and not exists (select 1 from products where name = 'Pointes ordinaires 70 mm — paquet 1 kg');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Tôle ondulée galvanisée — plaque 3 m', 'plaque', 15
from product_categories c where c.slug = 'gros-oeuvre'
and not exists (select 1 from products where name = 'Tôle ondulée galvanisée — plaque 3 m');

-- ============ Plomberie ============
insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Tuyau PVC évacuation Ø100 — longueur 4 m', 'barre', 40
from product_categories c where c.slug = 'plomberie'
and not exists (select 1 from products where name = 'Tuyau PVC évacuation Ø100 — longueur 4 m');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Coude PVC Ø100 90°', 'pièce', 100
from product_categories c where c.slug = 'plomberie'
and not exists (select 1 from products where name = 'Coude PVC Ø100 90°');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Robinet mélangeur lavabo chromé', 'pièce', 12
from product_categories c where c.slug = 'plomberie'
and not exists (select 1 from products where name = 'Robinet mélangeur lavabo chromé');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Colle PVC — pot 1 L', 'pot', 20
from product_categories c where c.slug = 'plomberie'
and not exists (select 1 from products where name = 'Colle PVC — pot 1 L');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Flexible de raccordement 50 cm', 'pièce', 40
from product_categories c where c.slug = 'plomberie'
and not exists (select 1 from products where name = 'Flexible de raccordement 50 cm');

-- ============ Électricité ============
insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Fil électrique VGV 2,5 mm² — rouleau 100 m', 'rouleau', 18
from product_categories c where c.slug = 'electricite'
and not exists (select 1 from products where name = 'Fil électrique VGV 2,5 mm² — rouleau 100 m');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Disjoncteur 16 A — 1 module', 'pièce', 35
from product_categories c where c.slug = 'electricite'
and not exists (select 1 from products where name = 'Disjoncteur 16 A — 1 module');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Ampoule LED 12 W — douille E27', 'pièce', 80
from product_categories c where c.slug = 'electricite'
and not exists (select 1 from products where name = 'Ampoule LED 12 W — douille E27');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Prise de courant 2P+T encastrée', 'pièce', 60
from product_categories c where c.slug = 'electricite'
and not exists (select 1 from products where name = 'Prise de courant 2P+T encastrée');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Projecteur LED extérieur 50 W', 'pièce', 14
from product_categories c where c.slug = 'electricite'
and not exists (select 1 from products where name = 'Projecteur LED extérieur 50 W');

-- ============ Peinture ============
insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Peinture latex vinylique — bidon 20 L', 'bidon', 10
from product_categories c where c.slug = 'peinture'
and not exists (select 1 from products where name = 'Peinture latex vinylique — bidon 20 L');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Rouleau de peinture 220 mm', 'pièce', 25
from product_categories c where c.slug = 'peinture'
and not exists (select 1 from products where name = 'Rouleau de peinture 220 mm');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Pinceau plat 2 pouces', 'pièce', 40
from product_categories c where c.slug = 'peinture'
and not exists (select 1 from products where name = 'Pinceau plat 2 pouces');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Mastic silicone sanitaire blanc — cartouche 310 ml', 'cartouche', 30
from product_categories c where c.slug = 'peinture'
and not exists (select 1 from products where name = 'Mastic silicone sanitaire blanc — cartouche 310 ml');

-- ============ Outillage ============
insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Marteau de coffreur 500 g', 'pièce', 15
from product_categories c where c.slug = 'outillage'
and not exists (select 1 from products where name = 'Marteau de coffreur 500 g');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Truelle ronde', 'pièce', 20
from product_categories c where c.slug = 'outillage'
and not exists (select 1 from products where name = 'Truelle ronde');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Mètre ruban 5 m', 'pièce', 30
from product_categories c where c.slug = 'outillage'
and not exists (select 1 from products where name = 'Mètre ruban 5 m');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Niveau à bulle 60 cm', 'pièce', 12
from product_categories c where c.slug = 'outillage'
and not exists (select 1 from products where name = 'Niveau à bulle 60 cm');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Brouette renforcée', 'pièce', 6
from product_categories c where c.slug = 'outillage'
and not exists (select 1 from products where name = 'Brouette renforcée');

-- ============ Serrurerie / EPI ============
insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Cadenas 40 mm — laiton', 'pièce', 25
from product_categories c where c.slug = 'serrurerie'
and not exists (select 1 from products where name = 'Cadenas 40 mm — laiton');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Serrure à cylindre avec poignée', 'pièce', 8
from product_categories c where c.slug = 'serrurerie'
and not exists (select 1 from products where name = 'Serrure à cylindre avec poignée');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Bottes de sécurité taille 42', 'paire', 10
from product_categories c where c.slug = 'serrurerie'
and not exists (select 1 from products where name = 'Bottes de sécurité taille 42');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Disque à tronçonner métal 230 mm', 'pièce', 40
from product_categories c where c.slug = 'serrurerie'
and not exists (select 1 from products where name = 'Disque à tronçonner métal 230 mm');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Casque de chantier', 'pièce', 20
from product_categories c where c.slug = 'serrurerie'
and not exists (select 1 from products where name = 'Casque de chantier');

-- ============ Matériel lourd ============
insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Bétonnière électrique 350 L', 'pièce', 3
from product_categories c where c.slug = 'materiel-lourd'
and not exists (select 1 from products where name = 'Bétonnière électrique 350 L');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Groupe électrogène 5 kVA', 'pièce', 2
from product_categories c where c.slug = 'materiel-lourd'
and not exists (select 1 from products where name = 'Groupe électrogène 5 kVA');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Plaque vibrante 5,5 cv', 'pièce', 2
from product_categories c where c.slug = 'materiel-lourd'
and not exists (select 1 from products where name = 'Plaque vibrante 5,5 cv');

-- ============ Électroportatif ============
insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Meuleuse d''angle 230 mm', 'pièce', 7
from product_categories c where c.slug = 'electroportatif'
and not exists (select 1 from products where name = 'Meuleuse d''angle 230 mm');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Perceuse à percussion 13 mm', 'pièce', 9
from product_categories c where c.slug = 'electroportatif'
and not exists (select 1 from products where name = 'Perceuse à percussion 13 mm');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Poste à souder Inverter 200 A', 'pièce', 4
from product_categories c where c.slug = 'electroportatif'
and not exists (select 1 from products where name = 'Poste à souder Inverter 200 A');

-- ============ Luminaires ============
insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Plafonnier LED décoratif avec télécommande', 'pièce', 8
from product_categories c where c.slug = 'luminaires'
and not exists (select 1 from products where name = 'Plafonnier LED décoratif avec télécommande');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Réglette LED 120 cm — 36 W', 'pièce', 20
from product_categories c where c.slug = 'luminaires'
and not exists (select 1 from products where name = 'Réglette LED 120 cm — 36 W');

insert into products (id, category_id, name, stock_unit, stock_qty)
select gen_random_uuid(), c.id, 'Spot LED encastrable 7 W', 'pièce', 50
from product_categories c where c.slug = 'luminaires'
and not exists (select 1 from products where name = 'Spot LED encastrable 7 W');

-- ============ Sale units ============
-- For every product that has none yet, create a default unit = stock_unit, factor 1, price 0 ("À configurer").
insert into product_sale_units (product_id, unit, price, factor_to_stock, is_default, allow_decimal)
select p.id, p.stock_unit, 0, 1, true, false
from products p
where not exists (select 1 from product_sale_units psu where psu.product_id = p.id);

-- Ciment: add a "tonne" sale unit. factor left at 1 with price 0 because the
-- sac->tonne conversion is NOT known automatically ("À configurer"); the boss
-- must configure it. We still expose the unit so the UI can show the choice.
insert into product_sale_units (product_id, unit, price, factor_to_stock, is_default, allow_decimal)
select p.id, 'tonne', 0, 1, false, true
from products p where p.name = 'Ciment CPJ 32.5 — Bélier (sac 50 kg)'
and not exists (select 1 from product_sale_units psu where psu.product_id = p.id and psu.unit = 'tonne');

-- Pointes 70mm: add a "carton" sale unit = 20 paquets (exact conversion).
insert into product_sale_units (product_id, unit, price, factor_to_stock, is_default, allow_decimal)
select p.id, 'carton', 0, 20, false, false
from products p where p.name = 'Pointes ordinaires 70 mm — paquet 1 kg'
and not exists (select 1 from product_sale_units psu where psu.product_id = p.id and psu.unit = 'carton');

-- Tuyau PVC Ø100: add a "m" (metre) sale unit. 1 barre = 4 m, exact.
insert into product_sale_units (product_id, unit, price, factor_to_stock, is_default, allow_decimal)
select p.id, 'm', 0, 0.25, false, true
from products p where p.name = 'Tuyau PVC évacuation Ø100 — longueur 4 m'
and not exists (select 1 from product_sale_units psu where psu.product_id = p.id and psu.unit = 'm');

-- Set indicative demo prices (FCFA) on the default sale units so the sales
-- flow is exercisable. These are clearly flagged "non vérifié" in the UI.
update product_sale_units set price = 4500  where unit = 'sac'    and price = 0;
update product_sale_units set price = 6000  where unit = 'barre'  and price = 0 and exists(select 1 from products p where p.name='Fer à béton HA Ø8 — barre 12 m' and p.id=product_sale_units.product_id);
update product_sale_units set price = 1500  where unit = 'barre'  and price = 0 and exists(select 1 from products p where p.name='Tuyau PVC évacuation Ø100 — longueur 4 m' and p.id=product_sale_units.product_id);
update product_sale_units set price = 1200  where unit = 'rouleau' and price = 0 and exists(select 1 from products p where p.name='Fil de fer recuit — rouleau 1 kg' and p.id=product_sale_units.product_id);
update product_sale_units set price = 35000 where unit = 'rouleau' and price = 0 and exists(select 1 from products p where p.name='Fil électrique VGV 2,5 mm² — rouleau 100 m' and p.id=product_sale_units.product_id);
update product_sale_units set price = 2000  where unit = 'paquet' and price = 0;
update product_sale_units set price = 15000 where unit = 'plaque' and price = 0;
update product_sale_units set price = 800   where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Coude PVC Ø100 90°' and p.id=product_sale_units.product_id);
update product_sale_units set price = 18000 where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Robinet mélangeur lavabo chromé' and p.id=product_sale_units.product_id);
update product_sale_units set price = 5000  where unit = 'pot'    and price = 0;
update product_sale_units set price = 1500  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Flexible de raccordement 50 cm' and p.id=product_sale_units.product_id);
update product_sale_units set price = 3500  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Disjoncteur 16 A — 1 module' and p.id=product_sale_units.product_id);
update product_sale_units set price = 1000  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Ampoule LED 12 W — douille E27' and p.id=product_sale_units.product_id);
update product_sale_units set price = 1500  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Prise de courant 2P+T encastrée' and p.id=product_sale_units.product_id);
update product_sale_units set price = 12000 where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Projecteur LED extérieur 50 W' and p.id=product_sale_units.product_id);
update product_sale_units set price = 45000 where unit = 'bidon'  and price = 0;
update product_sale_units set price = 2500  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Rouleau de peinture 220 mm' and p.id=product_sale_units.product_id);
update product_sale_units set price = 1000  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Pinceau plat 2 pouces' and p.id=product_sale_units.product_id);
update product_sale_units set price = 3000  where unit = 'cartouche' and price = 0;
update product_sale_units set price = 5000  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Marteau de coffreur 500 g' and p.id=product_sale_units.product_id);
update product_sale_units set price = 3500  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Truelle ronde' and p.id=product_sale_units.product_id);
update product_sale_units set price = 2000  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Mètre ruban 5 m' and p.id=product_sale_units.product_id);
update product_sale_units set price = 8000  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Niveau à bulle 60 cm' and p.id=product_sale_units.product_id);
update product_sale_units set price = 60000 where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Brouette renforcée' and p.id=product_sale_units.product_id);
update product_sale_units set price = 3500  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Cadenas 40 mm — laiton' and p.id=product_sale_units.product_id);
update product_sale_units set price = 20000 where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Serrure à cylindre avec poignée' and p.id=product_sale_units.product_id);
update product_sale_units set price = 25000 where unit = 'paire'  and price = 0;
update product_sale_units set price = 3000  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Disque à tronçonner métal 230 mm' and p.id=product_sale_units.product_id);
update product_sale_units set price = 4000  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Casque de chantier' and p.id=product_sale_units.product_id);
update product_sale_units set price = 250000 where unit = 'pièce' and price = 0 and exists(select 1 from products p where p.name='Bétonnière électrique 350 L' and p.id=product_sale_units.product_id);
update product_sale_units set price = 400000 where unit = 'pièce' and price = 0 and exists(select 1 from products p where p.name='Groupe électrogène 5 kVA' and p.id=product_sale_units.product_id);
update product_sale_units set price = 350000 where unit = 'pièce' and price = 0 and exists(select 1 from products p where p.name='Plaque vibrante 5,5 cv' and p.id=product_sale_units.product_id);
update product_sale_units set price = 60000 where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Meuleuse d''angle 230 mm' and p.id=product_sale_units.product_id);
update product_sale_units set price = 45000 where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Perceuse à percussion 13 mm' and p.id=product_sale_units.product_id);
update product_sale_units set price = 120000 where unit = 'pièce' and price = 0 and exists(select 1 from products p where p.name='Poste à souder Inverter 200 A' and p.id=product_sale_units.product_id);
update product_sale_units set price = 35000 where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Plafonnier LED décoratif avec télécommande' and p.id=product_sale_units.product_id);
update product_sale_units set price = 12000 where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Réglette LED 120 cm — 36 W' and p.id=product_sale_units.product_id);
update product_sale_units set price = 3000  where unit = 'pièce'  and price = 0 and exists(select 1 from products p where p.name='Spot LED encastrable 7 W' and p.id=product_sale_units.product_id);
