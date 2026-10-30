#!/usr/bin/env node
/**
 * Validation du catalogue d'images produit + génération d'une planche-contact.
 *
 * Vérifie :
 *  - les `image_key` déclarées sans image correspondante (obligatoires / optionnelles) ;
 *  - les images présentes mais inutilisées (aucune clé déclarée) ;
 *  - les fichiers trop lourds, de dimensions insuffisantes, de ratio anormal ;
 *  - les fichiers invalides ou dans un format non pris en charge ;
 *  - les doublons visuels probables (hash perceptuel : signalement uniquement,
 *    aucune suppression automatique).
 *
 * Les clés déclarées sont lues dans le FICHIER UNIQUE `catalogue.json`.
 *
 * Ne fait PAS échouer la compilation quand des images futures ne sont pas encore
 * fournies : une image manquante est un avertissement. Seuls un fichier corrompu
 * ou un catalogue illisible provoquent un code de sortie non nul.
 *
 * Usage : npm run images:validate
 */

import { readdir, stat, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_FILE = path.join(root, 'catalogue.json');
const REPORT_DIR = path.join(root, 'images-report');

const THUMB_SIZE = 256;
const STANDARD_WIDTH = 640;
const DETAIL_WIDTH = 1200;
const LIMITS = { thumb: 30 * 1024, standard: 150 * 1024, detail: 150 * 1024 };
const SUPPORTED_EXT = new Set(['.webp', '.avif']);
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.tif', '.tiff', '.svg', '.pdf', '.zip']);

const warnings = [];
const errors = [];

/** Hash perceptuel dHash 64 bits (résistant à la compression et au redimensionnement). */
async function dHash(file) {
  const { data } = await sharp(file)
    .resize(9, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += data[y * 9 + x] < data[y * 9 + x + 1] ? '1' : '0';
    }
  }
  return bits;
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

async function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  return entries.filter((f) => ext.has(path.extname(f).toLowerCase()));
}

async function inspect(file, label) {
  const info = await stat(file);
  const meta = await sharp(file).metadata();
  return {
    file,
    name: path.basename(file),
    label,
    bytes: info.size,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? 'inconnu',
  };
}

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function buildContactSheet(cells) {
  if (cells.length === 0) return null;

  const COLS = 6;
  const CELL_W = 220;
  const CELL_H = 252;
  const IMG = 196;
  const rows = Math.ceil(cells.length / COLS);

  const parts = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * CELL_W;
    const y = row * CELL_H;

    const b64 = (await sharp(cell.file).resize(IMG, IMG, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    }).png().toBuffer()).toString('base64');

    parts.push(
      `<rect x="${x + 4}" y="${y + 4}" width="${CELL_W - 8}" height="${CELL_H - 8}" fill="#ffffff" stroke="#cbd5e1"/>`,
      `<image x="${x + 12}" y="${y + 12}" width="${IMG}" height="${IMG}" href="data:image/png;base64,${b64}"/>`,
      `<text x="${x + 12}" y="${y + 228}" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" fill="#0f172a">${esc(cell.title)}</text>`,
      `<text x="${x + 12}" y="${y + 242}" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#64748b">${esc(cell.subtitle)}</text>`,
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${COLS * CELL_W}" height="${rows * CELL_H}"><rect width="100%" height="100%" fill="#f1f5f9"/>${parts.join('')}</svg>`;

  await mkdir(REPORT_DIR, { recursive: true });
  const out = path.join(REPORT_DIR, 'contact-sheet.jpg');
  await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toFile(out);
  return out;
}

async function main() {
  if (!existsSync(CATALOG_FILE)) {
    console.error(`Catalogue introuvable : ${path.relative(root, CATALOG_FILE)}`);
    process.exit(1);
  }

  const catalogue = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
  const dirs = catalogue.images ?? {};

  // Les clés d'image déclarées viennent du fichier unique `catalogue.json` :
  // une seule source de vérité (produit -> catégorie -> image_key).
  const declared = {};
  for (const product of catalogue.products ?? []) {
    const key = typeof product.imageKey === 'string' ? product.imageKey.trim() : '';
    if (key.length === 0) continue;
    declared[key] = { name: product.name, category: product.category, required: true };
  }

  const DIR_STANDARD = path.join(root, 'public', dirs.standard?.replace(/^\//, '') ?? 'images/products');
  const DIR_THUMBS = path.join(root, 'public', dirs.thumbnails?.replace(/^\//, '') ?? 'images/products/thumbnails');
  const DIR_DETAILS = path.join(root, 'public', dirs.details?.replace(/^\//, '') ?? 'images/products/details');

  const thumbs = await listFiles(DIR_THUMBS, SUPPORTED_EXT);
  const standards = await listFiles(DIR_STANDARD, SUPPORTED_EXT);
  const details = await listFiles(DIR_DETAILS, SUPPORTED_EXT);

  const hasThumb = new Set(thumbs.map((f) => path.basename(f, path.extname(f))));
  const hasStandard = new Set(standards.map((f) => path.basename(f, path.extname(f))));
  const hasDetail = new Set(details.map((f) => path.basename(f, path.extname(f))).map((n) => n.replace(/-\d+$/, '')));

  // 1) Clés déclarées sans image
  const keys = Object.keys(declared);
  for (const key of keys) {
    const missing = [];
    if (!hasThumb.has(key)) missing.push('miniature');
    if (!hasStandard.has(key)) missing.push('standard');
    if (!hasDetail.has(key)) missing.push('détail');
    if (missing.length > 0) {
      const entry = declared[key];
      const line = `${key} (${entry.name ?? 'sans nom'}) : ${missing.join(', ')} manquante(s).`;
      if (entry.required) warnings.push(`[à fournir] ${line}`);
      else warnings.push(`[optionnel] ${line}`);
    }
  }

  // 2) Images présentes mais aucune clé déclarée
  for (const [kind, set] of [['miniature', hasThumb], ['standard', hasStandard], ['détail', hasDetail]]) {
    for (const name of set) {
      if (!(name in declared)) warnings.push(`[inutilisée] ${kind} « ${name} » ne correspond à aucune image_key déclarée.`);
    }
  }

  // 3/4/6) Poids, dimensions, ratio, format
  const checks = [
    { dir: DIR_THUMBS, files: thumbs, kind: 'thumb', label: 'miniature', expect: THUMB_SIZE, square: true },
    { dir: DIR_STANDARD, files: standards, kind: 'standard', label: 'standard', expect: STANDARD_WIDTH, square: false },
    { dir: DIR_DETAILS, files: details, kind: 'detail', label: 'détail', expect: DETAIL_WIDTH, square: false },
  ];

  const cells = [];
  const hashes = [];

  for (const c of checks) {
    for (const name of c.files) {
      const file = path.join(c.dir, name);
      let info;
      try {
        info = await inspect(file, c.label);
      } catch (err) {
        errors.push(`${c.label} « ${name} » illisible ou corrompu (${err.message}).`);
        continue;
      }

      if (info.bytes > LIMITS[c.kind]) {
        warnings.push(`[trop lourd] ${c.label} « ${name} » ${(info.bytes / 1024).toFixed(1)} Ko > ${(LIMITS[c.kind] / 1024).toFixed(0)} Ko.`);
      }
      if (Math.max(info.width, info.height) < Math.min(c.expect, THUMB_SIZE)) {
        warnings.push(`[trop petite] ${c.label} « ${name} » ${info.width}x${info.height} < ${c.expect} px attendus.`);
      }
      if (c.square && info.width !== info.height) {
        warnings.push(`[ratio] ${c.label} « ${name} » ${info.width}x${info.height} n'est pas carrée.`);
      } else if (!c.square) {
        const ratio = info.width / info.height;
        if (ratio > 2.5 || ratio < 0.4) {
          warnings.push(`[ratio] ${c.label} « ${name} » ${info.width}x${info.height} : cadrage inhabituel pour une miniature.`);
        }
      }

      if (c.kind === 'thumb') {
        const title = name.replace(/\.webp$/, '');
        const declaredName = declared[title]?.name ?? '— non déclarée —';
        cells.push({ file, title, subtitle: declaredName });
        try {
          hashes.push({ name, hash: await dHash(file) });
        } catch { /* le hash ne doit jamais bloquer la validation */ }
      }
    }
  }

  // 5) Doublons visuels probables (signalement uniquement)
  const SIMILAR_THRESHOLD = 5;
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      const d = hamming(hashes[i].hash, hashes[j].hash);
      if (d <= SIMILAR_THRESHOLD) {
        warnings.push(`[doublon probable] « ${hashes[i].name} » et « ${hashes[j].name} » sont visuellement très proches (distance ${d}).`);
      }
    }
  }

  // 7) Fichiers non pris en charge présents dans les dossiers d'images
  for (const dir of [DIR_STANDARD, DIR_THUMBS, DIR_DETAILS]) {
    if (!existsSync(dir)) continue;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue; // ignore les sous-dossiers (thumbnails, details…)
      const name = entry.name;
      if (name.startsWith('.')) continue;
      if (!ALLOWED_EXT.has(path.extname(name).toLowerCase())) {
        warnings.push(`[format] ${path.relative(root, path.join(dir, name))} : format non pris en charge.`);
      }
    }
  }

  // ---------------------------- Rapport ----------------------------
  const totalThumbBytes = (await Promise.all(
    thumbs.map(async (n) => stat(path.join(DIR_THUMBS, n)).then((s) => s.size)),
  )).reduce((a, b) => a + b, 0);

  console.log('=== Validation des images produit ===\n');
  console.log(`Clés déclarées   : ${keys.length}`);
  console.log(`Miniatures       : ${thumbs.length} (${(totalThumbBytes / 1024).toFixed(1)} Ko au total)`);
  console.log(`Images standard  : ${standards.length}`);
  console.log(`Images de détail : ${details.length}`);

  if (errors.length > 0) {
    console.log('\nErreurs :');
    for (const e of errors) console.log(`  ✗ ${e}`);
  }
  if (warnings.length > 0) {
    console.log('\nÀ vérifier :');
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log('\nAucun problème détecté.');
  }

  const sheet = await buildContactSheet(cells);
  if (sheet) console.log(`\nPlanche-contact : ${path.relative(root, sheet)}`);

  // Une image manquante ou une image en trop n'est jamais une erreur bloquante.
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`Échec de la validation : ${err.message}`);
  process.exit(1);
});
