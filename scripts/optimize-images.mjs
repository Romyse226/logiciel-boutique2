#!/usr/bin/env node
/**
 * Optimisation des images produit (WebP).
 *
 * Entrée  : images-sources/{image_key}.{png|jpg|jpeg|webp|tif|tiff|avif}
 * Sorties : public/images/products/thumbnails/{image_key}.webp        (256 x 256)
 *           public/images/products/{image_key}.webp                   (<= 640 px)
 *           public/images/products/details/{image_key}-1200.webp      (<= 1200 px)
 *
 * Règles :
 *  - les fichiers SOURCES ne sont jamais modifiés ni supprimés ;
 *  - un fichier de sortie n'est régénéré que si la source est plus récente
 *    (utiliser --force pour tout regénérer) => pas de doublons, pas de travail inutile ;
 *  - l'AVIF est désactivé par défaut (option --avif) ;
 *  - le script se termine par un rapport des poids réels.
 *
 * Usage : npm run images:optimize [-- --force] [-- --avif] [-- --key=<image_key>]
 */

import { readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES_DIR = path.join(root, 'images-sources');
const OUT_STANDARD = path.join(root, 'public', 'images', 'products');
const OUT_THUMBS = path.join(OUT_STANDARD, 'thumbnails');
const OUT_DETAILS = path.join(OUT_STANDARD, 'details');

const THUMB_SIZE = 256;
const STANDARD_WIDTH = 640;
const DETAIL_WIDTH = 1200;

// Poids cibles (octets) — signaler les exceptions sans bloquer.
const LIMITS = { thumb: 30 * 1024, standard: 150 * 1024, detail: 150 * 1024 };

const SUPPORTED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.avif']);

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const WITH_AVIF = args.includes('--avif');
const ONLY_KEY = args.find((a) => a.startsWith('--key='))?.slice('--key='.length) || null;

/**
 * Génère une variante sans jamais toucher à la source.
 * @param {() => import('sharp').Sharp} build  fabrique de pipeline (une par variante)
 */
async function emit(build, srcPath, outPath, quality, label) {
  if (!FORCE && existsSync(outPath)) {
    const [src, out] = await Promise.all([stat(srcPath), stat(outPath)]);
    if (out.mtimeMs >= src.mtimeMs) return { skipped: true, label };
  }

  const buf = await build().webp({ quality, effort: 5 }).toBuffer();
  await writeFile(outPath, buf);

  if (WITH_AVIF) {
    const avif = await build().avif({ quality: Math.max(30, quality - 15) }).toBuffer();
    await writeFile(outPath.replace(/\.webp$/, '.avif'), avif);
  }

  const info = await sharp(buf).metadata();
  return { skipped: false, bytes: buf.length, width: info.width, height: info.height, label };
}

async function main() {
  const results = [];
  const problems = [];

  if (!existsSync(SOURCES_DIR)) {
    console.log(`Aucun dossier de sources (${path.relative(root, SOURCES_DIR)}). Rien à optimiser.`);
    return;
  }

  await Promise.all([
    mkdir(OUT_STANDARD, { recursive: true }),
    mkdir(OUT_THUMBS, { recursive: true }),
    mkdir(OUT_DETAILS, { recursive: true }),
  ]);

  let files = (await readdir(SOURCES_DIR)).filter((f) => SUPPORTED_EXT.has(path.extname(f).toLowerCase()));
  if (ONLY_KEY) files = files.filter((f) => path.basename(f, path.extname(f)) === ONLY_KEY);

  if (files.length === 0) {
    console.log('Aucune image source à optimiser.');
    return;
  }

  for (const file of files) {
    const key = path.basename(file, path.extname(file));
    const srcPath = path.join(SOURCES_DIR, file);

    try {
      const meta = await sharp(srcPath).metadata();
      if (!meta.width || !meta.height) throw new Error('dimensions illisibles');

      const ratio = meta.width / meta.height;
      if (ratio > 2.5 || ratio < 0.4) {
        problems.push(`${key} : cadrage inhabituel (${meta.width}x${meta.height}), à vérifier en miniature.`);
      }

      // 1) Miniature carrée 256 x 256 : mise à l'échelle « contain » sur fond blanc
      //    (aucun recadrage agressif, donc jamais de produit coupé).
      const thumb = await emit(
        () => sharp(srcPath).resize(THUMB_SIZE, THUMB_SIZE, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        }),
        srcPath, path.join(OUT_THUMBS, `${key}.webp`), 72, 'miniature',
      );

      // 2) Image standard : 640 px maximum sur le plus grand côté, ratio conservé.
      const standard = await emit(
        () => sharp(srcPath).resize(STANDARD_WIDTH, STANDARD_WIDTH, { fit: 'inside', withoutEnlargement: true }),
        srcPath, path.join(OUT_STANDARD, `${key}.webp`), 76, 'standard',
      );

      // 3) Image de détail (1200 px) : jamais préchargée, téléchargée sur grand écran.
      const detail = await emit(
        () => sharp(srcPath).resize(DETAIL_WIDTH, DETAIL_WIDTH, { fit: 'inside', withoutEnlargement: true }),
        srcPath, path.join(OUT_DETAILS, `${key}-${DETAIL_WIDTH}.webp`), 78, 'détail',
      );

      const entry = { key, thumb, standard, detail };
      results.push(entry);

      for (const [kind, limit] of [['thumb', LIMITS.thumb], ['standard', LIMITS.standard], ['detail', LIMITS.detail]]) {
        const v = entry[kind];
        if (!v.skipped && v.bytes > limit) {
          problems.push(`${key} : ${v.label} ${(v.bytes / 1024).toFixed(1)} Ko > cible ${(limit / 1024).toFixed(0)} Ko.`);
        }
      }
    } catch (err) {
      problems.push(`${key} : fichier invalide ou non pris en charge (${err.message}).`);
    }
  }

  // ---------------------------- Rapport ----------------------------
  const total = (kind) => results.reduce((sum, r) => sum + (r[kind].skipped ? 0 : r[kind].bytes), 0);
  const ko = (n) => `${(n / 1024).toFixed(1)} Ko`;

  console.log('\n' + 'Image (image_key)'.padEnd(40) + 'miniature'.padEnd(14) + 'standard'.padEnd(14) + 'détail');
  console.log('-'.repeat(82));
  for (const r of results) {
    const cell = (v) => (v.skipped ? 'à jour' : ko(v.bytes));
    console.log(r.key.padEnd(40) + cell(r.thumb).padEnd(14) + cell(r.standard).padEnd(14) + cell(r.detail));
  }
  console.log('-'.repeat(82));
  console.log(`${results.length} image(s) traitée(s).`);
  console.log(`Total généré : miniatures ${ko(total('thumb'))} | standard ${ko(total('standard'))} | détail ${ko(total('detail'))}`);
  if (WITH_AVIF) console.log('Variantes AVIF générées (option --avif).');

  if (problems.length > 0) {
    console.log('\nPoints à vérifier :');
    for (const p of problems) console.log(`  - ${p}`);
  }
}

main().catch((err) => {
  console.error(`Échec de l'optimisation : ${err.message}`);
  process.exit(1);
});
