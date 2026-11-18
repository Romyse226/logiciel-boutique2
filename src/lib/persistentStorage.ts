/**
 * Stockage persistant partagé Safari ↔ PWA iOS.
 *
 * Sur iOS, `localStorage` de Safari et celui de la PWA ajoutée à l'écran
 * d'accueil sont DEUX espaces séparés. Les cookies, en revanche, sont
 * partagés. On stocke donc chaque valeur à la fois en cookie (source de
 * vérité inter-contexte) et en localStorage (fallback rapide + contextes
 * sans cookies, ex: mode privé strict).
 *
 * Format identique à l'API Storage : getItem / setItem / removeItem.
 */

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 an

function cookieName(key: string): string {
  // Les noms de cookie ne peuvent contenir ni espace ni certains caractères.
  return `qs_${key.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function readCookie(name: string): string | null {
  try {
    const match = document.cookie.match(
      new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'),
    );
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function writeCookie(name: string, value: string, maxAge = COOKIE_MAX_AGE): void {
  try {
    // SameSite=Lax : fonctionne en PWA iOS et en navigation top-level.
    // Secure uniquement si HTTPS (sinon le cookie est ignoré en dev http).
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  } catch {
    /* ignore */
  }
}

function deleteCookie(name: string): void {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  } catch {
    /* ignore */
  }
}

export const persistentStorage = {
  getItem(key: string): string | null {
    // Cookie d'abord (partagé Safari ↔ PWA), puis localStorage.
    const fromCookie = readCookie(cookieName(key));
    if (fromCookie !== null) return fromCookie;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  setItem(key: string, value: string): void {
    writeCookie(cookieName(key), value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },

  removeItem(key: string): void {
    deleteCookie(cookieName(key));
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },

  /** Écrit uniquement le cookie (utile pour préserver un contexte d'invitation). */
  setCookieOnly(key: string, value: string, maxAge = COOKIE_MAX_AGE): void {
    writeCookie(cookieName(key), value, maxAge);
  },

  /** Lit uniquement le cookie (utile en mode PWA pour rattraper une invitation). */
  getCookieOnly(key: string): string | null {
    return readCookie(cookieName(key));
  },

  removeCookieOnly(key: string): void {
    deleteCookie(cookieName(key));
  },
};