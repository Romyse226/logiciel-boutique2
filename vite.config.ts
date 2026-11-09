import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Version du cache des images produit.
 * À incrémenter (`v1` -> `v2`) uniquement lorsqu'un fichier image est REMPLACÉ
 * en gardant le même nom : le navigateur retélécharge alors les images une seule
 * fois, au lieu de servir indéfiniment l'ancienne version.
 */
const PRODUCT_IMAGE_CACHE = 'product-images-v1';

/**
 * Vrai si au moins une miniature existe déjà dans `public/images/products/thumbnails`.
 * Tant qu'aucune image n'a été déposée, on n'ajoute pas le motif de glob au
 * précache : cela évite un avertissement Workbox inutile (« pattern doesn't
 * match any files ») et garde la compilation parfaitement silencieuse.
 */
function hasProductThumbnails(): boolean {
  const dir = fileURLToPath(new URL('./public/images/products/thumbnails', import.meta.url));
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((file) => file.toLowerCase().endsWith('.webp'));
  } catch {
    return false;
  }
}

const THUMBNAIL_GLOB = 'images/products/thumbnails/*.webp';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'favicon.ico', 'apple-touch-icon.png', 'apple-touch-180.png'],
      manifest: {
        name: 'Quincaillerie — Vente & Stock',
        short_name: 'Quincaillerie',
        description: 'Application de vente pour quincaillerie en Côte d\'Ivoire.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f8fafc',
        theme_color: '#8B5CF6',
        categories: ['business', 'shopping', 'productivity'],
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Les miniatures (256 px, ~10-20 Ko) sont mises en cache au moment de
        // l'installation : le catalogue s'affiche donc entièrement hors ligne.
        // Les images standard et de détail ne sont PAS préchargées (voir le
        // runtimeCaching ci-dessous) pour ne pas consommer de données mobiles :
        // elles ne sont téléchargées que lorsqu'un produit est réellement affiché.
        globPatterns: [
          '**/*.{js,css,html,svg,png,ico,woff,woff2}',
          ...(hasProductThumbnails() ? [THUMBNAIL_GLOB] : []),
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/__/, /^\/api\//, /^\/functions\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Toute image produit jamais affichée est conservée en cache local :
            // jamais retéléchargée, même après une coupure réseau.
            urlPattern: /\/images\/products\//,
            handler: 'CacheFirst',
            options: {
              cacheName: PRODUCT_IMAGE_CACHE,
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 365,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
