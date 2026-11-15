const configuredBaseDomain = (import.meta.env.VITE_BASE_DOMAIN ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
const configuredRoutingMode = (import.meta.env.VITE_TENANT_ROUTING ?? '').trim().toLowerCase();

export function usesPathRouting(hostname = window.location.hostname): boolean {
  if (configuredRoutingMode === 'path') return true;
  if (configuredRoutingMode === 'subdomain') return false;
  return hostname.toLowerCase().endsWith('.vercel.app');
}

export interface HostContext {
  configured: boolean;
  root: boolean;
  slug: string | null;
}

export function getHostContext(hostname = window.location.hostname, pathname = window.location.pathname): HostContext {
  const host = hostname.toLowerCase();
  if (usesPathRouting(host)) {
    const match = pathname.match(/^\/store\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i);
    const slug = match?.[1]?.toLowerCase() ?? null;
    return {
      configured: Boolean(configuredBaseDomain) || host.endsWith('.vercel.app'),
      root: !slug && (pathname === '/' || pathname === '/index.html'),
      slug,
    };
  }

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
  if (usesPathRouting(hostname)) return `${protocol}//${hostname}${port}/store/${slug}`;
  if (configuredBaseDomain) {
    if (configuredBaseDomain === 'localhost') return `${protocol}//${slug}.localhost${port}`;
    return `${protocol}//${slug}.${configuredBaseDomain}`;
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${slug}.localhost${port}`;
  }
  return null;
}
