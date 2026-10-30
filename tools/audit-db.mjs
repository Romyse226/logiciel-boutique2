/**
 * Audit du serveur Supabase distant : quelles migrations sont réellement
 * appliquées, quelles colonnes existent, combien de données sont présentes.
 * Lecture seule : n'écrit jamais.
 *
 * Usage : node tools/audit-db.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(here, '..', '.env'), 'utf8');
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL_BASE = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;
if (!URL_BASE || !KEY) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY absents de .env');
  process.exit(1);
}

const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function probe(table, query = '') {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${query}`, { headers: HEADERS });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* garde le texte */ }
  return { status: res.status, body };
}

/** Vérifie l'existence d'une colonne (400 + message si absente). */
async function hasColumn(table, column) {
  const r = await probe(table, `select=${column}&limit=1`);
  return r.status === 200 ? 'oui' : r.status === 400 ? 'non' : `? (${r.status})`;
}

async function count(table, filter = '') {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=id${filter ? `&${filter}` : ''}`, {
    headers: { ...HEADERS, Prefer: 'count=exact', Range: '0-0' },
  });
  const cr = res.headers.get('content-range') ?? '';
  return `${cr} (HTTP ${res.status})`;
}

console.log('=== Supabase :', URL_BASE, '===\n');

console.log('--- Colonnes attendues ---');
for (const [t, col] of [
  ['products', 'is_archived'],
  ['products', 'image_url'],
  ['products', 'stock_qty'],
  ['product_sale_units', 'factor_to_stock'],
  ['product_categories', 'sort_order'],
  ['stock_movements', 'reason'],
  ['sales', 'cancelled_at'],
  ['employees', 'can_edit_catalog'],
]) {
  console.log(`  ${t}.${col} : ${await hasColumn(t, col)}`);
}

console.log('\n--- Volumétrie ---');
for (const t of ['product_categories', 'products', 'product_sale_units', 'sales', 'sale_items', 'stock_movements']) {
  console.log(`  ${t} : ${await count(t)}`);
}
console.log(`  products (archivés) : ${await count('products', 'is_archived=eq.true')}`);
console.log(`  products (actifs)   : ${await count('products', 'is_archived=eq.false')}`);

console.log('\n--- Catégories présentes ---');
const cats = await probe('product_categories', 'select=slug,name,sort_order&order=sort_order');
console.log(' ', cats.status, JSON.stringify(cats.body));

console.log('\n--- RPC (migrations) ---');
for (const fn of ['register_sale', 'save_product', 'list_employees', 'create_employee', 'ensure_owner', 'employee_state']) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: '{}',
  });
  console.log(`  ${fn} : HTTP ${res.status}`);
}

console.log('\n--- Storage bucket product-images ---');
const bucket = await fetch(`${URL_BASE}/storage/v1/bucket/product-images`, { headers: HEADERS });
console.log('  GET bucket : HTTP', bucket.status, (await bucket.text()).slice(0, 200));
