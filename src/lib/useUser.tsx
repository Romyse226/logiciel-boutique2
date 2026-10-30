import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserProfile, UserRole } from '@/types';

const STORAGE_KEY = 'quincaillerie.userProfile';
const DEVICE_KEY = 'quincaillerie.deviceToken';

/** Jeton d'appareil (64 caractères hexadécimaux) — sert à réclamer la place de boss. */
function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function loadDeviceToken(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && existing.length >= 32) return existing;
    const t = randomToken();
    localStorage.setItem(DEVICE_KEY, t);
    return t;
  } catch {
    return randomToken();
  }
}

function loadProfile(): UserProfile {
  const deviceToken = loadDeviceToken();
  let stored: Partial<UserProfile> | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<UserProfile>;
  } catch { /* ignore */ }

  // En développement, la session locale est TOUJOURS celle du BOSS : cela
  // permet de tester l'ajout d'employés, l'administration et la suspension.
  if (import.meta.env.DEV) {
    const wasBoss = stored?.role === 'gerant' && stored.isOwner === true;
    return {
      role: 'gerant',
      name: (wasBoss && stored?.name) || 'Boss',
      canEditCatalog: true,
      canAddProducts: true,
      employeeId: wasBoss ? (stored?.employeeId ?? null) : null,
      accessToken: wasBoss ? (stored?.accessToken ?? '') : '',
      isOwner: true,
      deviceToken,
      onboarded: !!stored?.onboarded,
      phone: stored?.phone ?? null,
    };
  }

  if (stored) {
    const p = stored;
    // Appareil du boss confirmé : on conserve son identité serveur.
    if (p?.role === 'gerant' && p.isOwner === true) {
      return {
        role: 'gerant',
        name: p.name || 'Boss',
        canEditCatalog: true,
        canAddProducts: true,
        employeeId: p.employeeId ?? null,
        accessToken: p.accessToken ?? '',
        isOwner: true,
        deviceToken,
        onboarded: !!p.onboarded,
        phone: p.phone ?? null,
      };
    }
    // Une identité employé n'est valable que si l'invitation du boss a été
    // acceptée (le serveur fournit alors un identifiant ET un jeton).
    if (p?.role === 'employe' && p.employeeId && p.accessToken) {
      const role: UserRole = 'employe';
      return {
        role,
        name: p.name || 'Employé',
        canEditCatalog: !!p.canEditCatalog,
        canAddProducts: !!p.canAddProducts,
        employeeId: p.employeeId,
        accessToken: p.accessToken,
        isOwner: false,
        deviceToken,
        onboarded: true,
        phone: null,
      };
    }
  }
  // Sinon cet appareil est celui du boss : c'est lui qui crée ensuite les
  // profils de ses employés et les invite. On ne le rétrograde jamais seul.
  return {
    role: 'gerant', name: 'Boss', canEditCatalog: true, canAddProducts: true,
    employeeId: null, accessToken: '', isOwner: true, deviceToken,
    onboarded: false, phone: null,
  };
}

interface IdentityInput {
  employeeId: string;
  name: string;
  accessToken: string;
}

interface UserContextValue {
  profile: UserProfile;
  /** true quand l'identité a été confirmée par le serveur (ou qu'aucun serveur n'est joignable). */
  identityReady: boolean;
  markIdentityReady: () => void;
  applyOwner: (o: IdentityInput) => void;
  applyEmployee: (e: IdentityInput & { canEditCatalog: boolean; canAddProducts: boolean }) => void;
  applyRemoteState: (s: { name?: string; canEditCatalog?: boolean; canAddProducts?: boolean }) => void;
  /** Enregistre le nom et le téléphone du boss saisis à l'inscription. */
  completeOnboarding: (name: string, phone: string | null) => void;
  clearIdentity: () => void;
  isGerant: boolean;
  canEditCatalog: boolean;
  canAddProducts: boolean;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<UserProfile>(() => loadProfile());
  const [identityReady, setIdentityReady] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch { /* ignore */ }
  }, [profile]);

  const markIdentityReady = useCallback(() => setIdentityReady(true), []);

  const applyOwner = useCallback((o: IdentityInput) => {
    setProfileState((prev) => ({
      ...prev,
      role: 'gerant',
      name: o.name || 'Boss',
      canEditCatalog: true,
      canAddProducts: true,
      employeeId: o.employeeId,
      accessToken: o.accessToken,
      isOwner: true,
      onboarded: true,
    }));
  }, []);

  const completeOnboarding = useCallback((name: string, phone: string | null) => {
    setProfileState((prev) => ({
      ...prev,
      name: name || prev.name || 'Boss',
      phone,
      onboarded: true,
    }));
  }, []);

  const applyEmployee = useCallback((e: IdentityInput & { canEditCatalog: boolean; canAddProducts: boolean }) => {
    setProfileState((prev) => ({
      ...prev,
      role: 'employe',
      name: e.name || 'Employé',
      canEditCatalog: !!e.canEditCatalog,
      canAddProducts: !!e.canAddProducts,
      employeeId: e.employeeId,
      accessToken: e.accessToken,
      isOwner: false,
      onboarded: true,
    }));
  }, []);

  const applyRemoteState = useCallback((s: { name?: string; canEditCatalog?: boolean; canAddProducts?: boolean }) => {
    setProfileState((prev) => {
      if (prev.isOwner) return prev;
      return {
        ...prev,
        name: s.name ?? prev.name,
        canEditCatalog: s.canEditCatalog ?? prev.canEditCatalog,
        canAddProducts: s.canAddProducts ?? prev.canAddProducts,
      };
    });
  }, []);

  /** Rétrograde en employé sans droits — l'identité serveur reste mémorisée. */
  const clearIdentity = useCallback(() => {
    setProfileState((prev) => ({
      ...prev,
      role: 'employe',
      name: prev.name || 'Employé',
      canEditCatalog: false,
      canAddProducts: false,
      isOwner: false,
    }));
  }, []);

  const value = useMemo<UserContextValue>(() => ({
    profile,
    identityReady,
    markIdentityReady,
    applyOwner,
    applyEmployee,
    applyRemoteState,
    completeOnboarding,
    clearIdentity,
    isGerant: profile.role === 'gerant' && profile.isOwner,
    canEditCatalog: profile.role === 'gerant' || profile.canEditCatalog,
    canAddProducts: profile.role === 'gerant' || profile.canAddProducts,
  }), [profile, identityReady, markIdentityReady, applyOwner, applyEmployee, applyRemoteState, completeOnboarding, clearIdentity]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within UserProvider');
  return ctx;
}
