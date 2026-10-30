#!/usr/bin/env node
/**
 * COMMANDE UNIQUE de gestion du catalogue standard.
 *
 *   npm run catalogue:sync        (ou : node scripts/catalogue-sync.mjs)
 *
 * Elle fait tout, dans l'ordre :
 *   1. verifie le fichier unique `catalogue.json` (identifiants uniques,
 *      categories connues, prix renseignes) ;
 *   2. optimise les images deposees dans `images-sources/` (WebP, 3 variantes :
 *      miniature 256 px / standard 640 px / detail 1200 px). Le nom du fichier
 *      doit etre EXACTEMENT la `imageKey` du produit ;
 *   3. genere `supabase/catalogue.generated.sql` : un script SQL idempotent qui
 *      cree/actualise les 8 categories et les produits du catalogue cote
 *      Supabase, a coller dans l'editeur SQL de Supabase.
 *
 * Le fichier SQL genere ne contient QUE des caracteres ASCII (les accents
 * passent par la syntaxe PostgreSQL U&'...\00e9...') : c'est le seul moyen
 * fiable d'eviter la corruption d'encodage deja rencontree sur ce projet.
 *
 * Ne supprime RIEN : aucun produit, aucun stock, aucune vente, aucun historique.
 *
 * Options :
 *   --force        reoptimise toutes les images (meme celles deja a jour)
 *   --skip-images  ne regenere que le fichier SQL
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_FILE = path.join(root, 'catalogue.json');
const SQL_FILE = path.join(root, 'supabase', 'catalogue.generated.sql');
const OPTIMIZE_SCRIPT = path.join(root, 'scripts', 'optimize-images.mjs');

const args = process.argv.slice(2);
const SKIP_IMAGES = args.includes('--skip-images');
const FORCE = args.includes('--force');

const UNIT_GROS = 'Gros';
const UNIT_DETAIL = 'D\u00e9tail';

const problems = [];

// ---------------------------------------------------------------------------
// Encodage SQL : chaine -> litteral ASCII sur (accents passes par U&'...')
// ---------------------------------------------------------------------------

function escapeUnicode(str) {
  let out = '';
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (cp >= 0x20 && cp <= 0x7e) out += ch;
    else if (cp <= 0xffff) out += '\\' + cp.toString(16).padStart(4, '0');
    else {
      const c = cp - 0x10000;
      const hi = Math.floor(c / 0x400) + 0xd800;
      const lo = (c % 0x400) + 0xdc00;
      out += '\\' + hi.toString(16).padStart(4, '0') + '\\' + lo.toString(16).padStart(4, '0');
    }
  }
  return `U&'${out}'`;
}

/** Litteral texte : U&'...' seulement si des caracteres non-ASCII sont presents. */
function sqlText(str) {
  const value = String(str);
  return /[^\x20-\x7e]/.test(value) ? escapeUnicode(value) : `'${value.replace(/'/g, "''")}'`;
}

function sqlNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? String(v) : '0';
}

// ---------------------------------------------------------------------------
// Validation du fichier unique
// ---------------------------------------------------------------------------

function validate(catalogue) {
  const categories = Array.isArray(catalogue.categories) ? catalogue.categories : [];
  const products = Array.isArray(catalogue.products) ? catalogue.products : [];

  if (categories.length === 0) problems.push('catalogue.json : aucune categorie declaree.');
  if (products.length === 0) problems.push('catalogue.json : aucun produit declare.');

  const slugs = new Set();
  for (const cat of categories) {
    if (!cat.slug || !cat.name) problems.push(`categorie incomplete : ${JSON.stringify(cat)}`);
    else if (slugs.has(cat.slug)) problems.push(`categorie en double : ${cat.slug}`);
    else slugs.add(cat.slug);
  }

  const keys = new Set();
  const imageKeys = new Set();
  for (const p of products) {
    if (!p.key || !p.name) {
      problems.push(`produit incomplet (key/name) : ${JSON.stringify(p)}`);
      continue;
    }
    if (keys.has(p.key)) problems.push(`cle produit en double : ${p.key}`);
    keys.add(p.key);

    if (!p.category) problems.push(`${p.key} : categorie manquante.`);
    else if (!slugs.has(p.category)) problems.push(`${p.key} : categorie « ${p.category} » inconnue (voir la liste « categories »).`);

    const gros = Number(p.gros?.price) || 0;
    const detail = Number(p.detail?.price) || 0;
    if (gros <= 0 && detail <= 0) problems.push(`${p.key} : renseignez au moins un prix (gros ou detail).`);

    const ik = typeof p.imageKey === 'string' ? p.imageKey.trim() : '';
    if (ik) {
      // Une meme image_key peut volontairement etre partagee par plusieurs produits.
      imageKeys.add(ik);
    }
  }

  return { categories, products, imageKeys };
}

// ---------------------------------------------------------------------------
// Generation du SQL (ASCII pur, idempotent, non destructif)
// ---------------------------------------------------------------------------

function categoryValues(categories) {
  return categories
    .map((c) => `  (${sqlText(c.slug)}, ${sqlText(c.name)}, ${sqlText(c.color)}, ${sqlNum(c.sortOrder)})`)
    .join(',\n');
}

function productRows(products) {
  return products
    .map((p) => {
      const ik = typeof p.imageKey === 'string' ? p.imageKey.trim() : '';
      const imageKey = ik ? sqlText(ik) : 'null';
      return `    (${sqlText(p.name)}, ${imageKey}, ${sqlText(p.stockUnit ?? 'unite')}, ${sqlText(p.category)})`;
    })
    .join(',\n');
}

function unitRows(products) {
  const rows = [];
  for (const p of products) {
    const ik = typeof p.imageKey === 'string' ? p.imageKey.trim() : '';
    if (!ik) continue;
    const gros = Number(p.gros?.price) || 0;
    const detail = Number(p.detail?.price) || 0;
    if (gros > 0) rows.push(`    (${sqlText(ik)}, ${sqlText(UNIT_GROS)}, ${sqlNum(gros)}, false)`);
    if (detail > 0) rows.push(`    (${sqlText(ik)}, ${sqlText(UNIT_DETAIL)}, ${sqlNum(detail)}, ${gros > 0 ? 'true' : 'false'})`);
  }
  return rows.join(',\n');
}

function buildSql(catalogue, categories, products) {
  const slugs = categories.map((c) => sqlText(c.slug)).join(', ');
  const imageKeys = products
    .map((p) => (typeof p.imageKey === 'string' ? p.imageKey.trim() : ''))
    .filter((k) => k.length > 0)
    .map(sqlText)
    .join(', ') || 'null';

  return `-- ===========================================================================
-- catalogue.generated.sql -- FICHIER GENERE AUTOMATIQUEMENT, NE PAS MODIFIER
--
-- Source   : catalogue.json (fichier unique de gestion du catalogue)
-- Regenerer: npm run catalogue:sync
-- Version  : ${catalogue.version ?? 'v1'}
--
-- PREREQUIS : migration 0008 (colonne products.image_key) deja appliquee.
--
-- Proprietes :
--   * IDEMPOTENT  : peut etre relance autant de fois que necessaire ;
--   * NON DESTRUCTIF : aucune vente, aucun stock, aucun historique n'est touche.
--     Le stock reel du commercant (stock_qty) et sa photo personnalisee
--     (image_url) ne sont JAMAIS modifies par ce script ;
--   * ASCII pur : les accents passent par U&'...\\00e9...' (aucune corruption
--     possible au copier-coller dans l'editeur SQL de Supabase).
-- ===========================================================================

-- ===========================================================================
-- 1. Les categories (mises a jour par identifiant stable "slug")
-- ===========================================================================
insert into product_categories (slug, name, color, sort_order)
values
${categoryValues(categories)}
on conflict (slug) do update
  set name = excluded.name,
      color = excluded.color,
      sort_order = excluded.sort_order;

-- Supprime uniquement les categories hors catalogue (les produits y faisant
-- reference passent a category_id = null, aucun produit n'est supprime).
delete from product_categories
 where slug not in (${slugs});

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
${productRows(products)}
  ) as d(name, image_key, unit, cat)
  join product_categories c on c.slug = d.cat
 where p.image_key = d.image_key;

insert into products (id, category_id, name, image_key, stock_unit, stock_qty,
                      low_stock_threshold, is_active, is_archived)
select gen_random_uuid(), c.id, d.name, d.image_key, d.unit, 0, 0, true, false
  from (values
${productRows(products)}
  ) as d(name, image_key, unit, cat)
  join product_categories c on c.slug = d.cat
 where not exists (select 1 from products p where p.image_key = d.image_key);

-- ===========================================================================
-- 3. Les prix Gros / Detail (unis par (produit, unite))
-- ===========================================================================
with data(image_key, unit, price, is_default) as (
  values
${unitRows(products)}
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
 where unit not in (${sqlText(UNIT_GROS)}, ${sqlText(UNIT_DETAIL)})
   and product_id in (select id from products where image_key in (${imageKeys}));

-- ===========================================================================
-- 4. Verification (facultatif) : liste les produits du catalogue et leurs prix
-- ===========================================================================
-- select p.name, p.image_key, p.stock_unit,
--        max(case when u.unit = ${sqlText(UNIT_GROS)} then u.price end) as prix_gros,
--        max(case when u.unit = ${sqlText(UNIT_DETAIL)} then u.price end) as prix_detail
--   from products p
--   left join product_sale_units u on u.product_id = p.id
--  where p.image_key in (${imageKeys})
--  group by p.name, p.image_key, p.stock_unit
--  order by p.name;
`;
}

// ---------------------------------------------------------------------------
// Programme principal
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(CATALOG_FILE)) {
    console.error(`Catalogue introuvable : ${path.relative(root, CATALOG_FILE)}`);
    process.exit(1);
  }

  let catalogue;
  try {
    catalogue = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
  } catch (err) {
    console.error(`catalogue.json illisible (JSON invalide) : ${err.message}`);
    process.exit(1);
  }

  const { categories, products, imageKeys } = validate(catalogue);

  if (problems.length > 0) {
    console.log('A corriger dans catalogue.json :');
    for (const p of problems) console.log(`  - ${p}`);
  }

  // 1) Optimisation des images deposees dans images-sources/
  if (!SKIP_IMAGES) {
    console.log('\n=== 1/2. Optimisation des images (images-sources/) ===');
    const argv = FORCE ? ['--force'] : [];
    const res = spawnSync(process.execPath, [OPTIMIZE_SCRIPT, ...argv], { cwd: root, stdio: 'inherit' });
    if (res.status !== 0) {
      console.log("Optimisation terminee avec des points a verifier (voir ci-dessus).");
    }
  }

  // 2) Generation du script SQL
  console.log('\n=== 2/2. Generation du script SQL Supabase ===');
  const sql = buildSql(catalogue, categories, products);
  await mkdir(path.dirname(SQL_FILE), { recursive: true });
  await writeFile(SQL_FILE, sql, 'utf8');

  console.log(`Catalogue      : ${products.length} produit(s), ${categories.length} categorie(s)`);
  console.log(`Images connues : ${imageKeys.size} cle(s) d'image`);
  console.log(`Fichier SQL    : ${path.relative(root, SQL_FILE)}`);
  console.log('\nEtape suivante : ouvrir ce fichier et coller tout son contenu dans');
  console.log("l'editeur SQL de Supabase, puis executer (Run). Le script est idempotent.");

  // Une incoherence dans le catalogue est un echec explicite.
  process.exit(problems.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`Echec de la synchronisation : ${err.message}`);
  process.exit(1);
});
