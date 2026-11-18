import { persistentStorage } from '@/lib/persistentStorage';

/**
 * Adaptateur de stockage pour Supabase Auth.
 *
 * Supabase, par défaut, persiste la session dans `window.localStorage`.
 * Sur iOS, ce stockage N'EST PAS PARTAGÉ entre Safari et la PWA ajoutée à
 * l'écran d'accueil : la session est donc perdue au premier lancement PWA.
 * Les cookies, eux, sont partagés. Cet adaptateur fait donc du cookie la
 * source de vérité, avec localStorage en repli.
 */
export const supabaseAuthStorage = {
  getItem(key: string): string | null {
    return persistentStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    persistentStorage.setItem(key, value);
  },
  removeItem(key: string): void {
    persistentStorage.removeItem(key);
  },
};