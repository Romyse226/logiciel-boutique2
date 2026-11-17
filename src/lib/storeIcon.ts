const LOCAL_ICON_KEY = 'quincaillerie.pwaStoreIcon.';
let manifestUrl: string | null = null;

export async function makeStoreIcon(file: File): Promise<{ blob: Blob; dataUrl: string }> {
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Impossible de traiter cette image.');

    const size = Math.min(image.width, image.height);
    context.drawImage(
      image,
      (image.width - size) / 2,
      (image.height - size) / 2,
      size,
      size,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Impossible de créer l’icône de la boutique.'));
      }, 'image/jpeg', 0.9);
    });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Impossible de préparer l’icône hors ligne.'));
      reader.onerror = () => reject(new Error('Impossible de lire l’icône.'));
      reader.readAsDataURL(blob);
    });
    return { blob, dataUrl };
  } finally {
    image.close();
  }
}

export function cacheStoreIcon(storeId: string, dataUrl: string): void {
  localStorage.setItem(`${LOCAL_ICON_KEY}${storeId}`, dataUrl);
}

export function cachedStoreIcon(storeId: string): string | null {
  try {
    return localStorage.getItem(`${LOCAL_ICON_KEY}${storeId}`);
  } catch {
    return null;
  }
}

export function applyPwaStoreIcon(iconUrl: string | null): void {
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((link) => {
    link.dataset.defaultHref ??= link.getAttribute('href') ?? '';
    link.dataset.defaultType ??= link.type;
    link.href = iconUrl ?? link.dataset.defaultHref;
    link.type = iconUrl ? 'image/jpeg' : link.dataset.defaultType;
  });
  document.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]').forEach((link) => {
    link.dataset.defaultHref ??= link.getAttribute('href') ?? '';
    link.href = iconUrl ?? link.dataset.defaultHref;
  });

  const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!iconUrl) {
    if (manifestLink) manifestLink.href = '/manifest.webmanifest';
    if (manifestUrl) URL.revokeObjectURL(manifestUrl);
    manifestUrl = null;
    return;
  }

  const manifest = {
    name: 'Mon logiciel',
    short_name: 'Mon logiciel',
    description: 'Application de vente pour quincaillerie en Côte d’Ivoire.',
    lang: 'fr',
    start_url: new URL('/', window.location.href).href,
    scope: new URL('/', window.location.href).href,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f8fafc',
    theme_color: '#8B5CF6',
    icons: [
      { src: iconUrl, sizes: '192x192', type: 'image/jpeg', purpose: 'any' },
      { src: iconUrl, sizes: '512x512', type: 'image/jpeg', purpose: 'maskable' },
    ],
  };
  const nextManifestUrl = URL.createObjectURL(
    new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }),
  );
  if (manifestLink) manifestLink.href = nextManifestUrl;
  if (manifestUrl) URL.revokeObjectURL(manifestUrl);
  manifestUrl = nextManifestUrl;
}
