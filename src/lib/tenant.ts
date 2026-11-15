const configuredBaseDomain = (import.meta.env.VITE_BASE_DOMAIN ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');

export interface HostContext {
  configured: boolean;
  root: boolean;
  slug: string | null;
}

export function getHostContext(hostname = window.location.hostname): HostContext {
  const host = hostname.toLowerCase();
  if (configuredBaseDomain) {
    if (host === configuredBaseDomain || host === `www.${configuredBaseDomain}`) {
      return { configured: true, root: true, slug: null };
    }
    if (host.endsWith(`.${configuredBaseDomain}`)) {
      const slug = host.slice(0, -(configuredBaseDomain.length + 1));
      if (slug && !slug.includes('.')) return { configured: true, root: false, slug };
    }
    return { configured: true, root: false, slug: null };
  }

  if (host === 'localhost' || host === '127.0.0.1') {
    return { configured: false, root: true, slug: null };
  }
  if (host.endsWith('.localhost')) {
    return { configured: false, root: false, slug: host.slice(0, -'.localhost'.length) };
  }
  return { configured: false, root: false, slug: null };
}

export function slugFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function storeUrl(slug: string): string | null {
  const hostname = window.location.hostname.toLowerCase();
  const protocol = window.location.protocol;
  const port = window.location.port ? `:${window.location.port}` : '';
  if (configuredBaseDomain) {
    if (configuredBaseDomain === 'localhost') return `${protocol}//${slug}.localhost${port}`;
    return `${protocol}//${slug}.${configuredBaseDomain}`;
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${slug}.localhost${port}`;
  }
  return null;
}
