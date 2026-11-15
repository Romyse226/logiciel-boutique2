import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { UserProfile } from '@/types';

const LEGACY_PROFILE_KEY = 'quincaillerie.userProfile';

interface LegacyEmployeeIdentity {
  employeeId: string;
  accessToken: string;
}

function readLegacyEmployeeIdentity(): LegacyEmployeeIdentity | null {
  try {
    const raw = localStorage.getItem(LEGACY_PROFILE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<UserProfile>;
    if (stored.role !== 'employe' || stored.isOwner || !stored.employeeId || !stored.accessToken) return null;
    return { employeeId: stored.employeeId, accessToken: stored.accessToken };
  } catch {
    return null;
  }
}

function emptyProfile(): UserProfile {
  return {
    role: 'employe',
    name: '',
    canEditCatalog: false,
    canAddProducts: false,
    employeeId: null,
    accessToken: '',
    isOwner: false,
    deviceToken: '',
    onboarded: false,
    phone: null,
  };
}

interface IdentityInput {
  employeeId: string;
  name: string;
}

interface UserContextValue {
  profile: UserProfile;
  identityReady: boolean;
  legacyEmployee: LegacyEmployeeIdentity | null;
  markIdentityReady: () => void;
  applyOwner: (identity: IdentityInput) => void;
  applyEmployee: (identity: IdentityInput & { canEditCatalog: boolean; canAddProducts: boolean }) => void;
  applyRemoteState: (state: { name?: string; canEditCatalog?: boolean; canAddProducts?: boolean }) => void;
  clearIdentity: () => void;
  clearLegacyIdentity: () => void;
  isGerant: boolean;
  canEditCatalog: boolean;
  canAddProducts: boolean;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile>(emptyProfile);
  const [identityReady, setIdentityReady] = useState(false);
  const [legacyEmployee, setLegacyEmployee] = useState<LegacyEmployeeIdentity | null>(readLegacyEmployeeIdentity);

  const markIdentityReady = useCallback(() => setIdentityReady(true), []);

  const applyOwner = useCallback((identity: IdentityInput) => {
    setProfile({
      ...emptyProfile(),
      role: 'gerant',
      name: identity.name || 'Gérant',
      canEditCatalog: true,
      canAddProducts: true,
      employeeId: identity.employeeId,
      isOwner: true,
      onboarded: true,
    });
  }, []);

  const applyEmployee = useCallback((identity: IdentityInput & { canEditCatalog: boolean; canAddProducts: boolean }) => {
    setProfile({
      ...emptyProfile(),
      role: 'employe',
      name: identity.name || 'Employé',
      canEditCatalog: identity.canEditCatalog,
      canAddProducts: identity.canAddProducts,
      employeeId: identity.employeeId,
      onboarded: true,
    });
  }, []);

  const applyRemoteState = useCallback((state: { name?: string; canEditCatalog?: boolean; canAddProducts?: boolean }) => {
    setProfile((current) => ({
      ...current,
      name: state.name ?? current.name,
      canEditCatalog: state.canEditCatalog ?? current.canEditCatalog,
      canAddProducts: state.canAddProducts ?? current.canAddProducts,
    }));
  }, []);

  const clearIdentity = useCallback(() => {
    setProfile(emptyProfile());
    setIdentityReady(true);
  }, []);

  const clearLegacyIdentity = useCallback(() => {
    try {
      localStorage.removeItem(LEGACY_PROFILE_KEY);
      localStorage.removeItem('quincaillerie.deviceToken');
    } finally {
      setLegacyEmployee(null);
    }
  }, []);

  const value = useMemo<UserContextValue>(() => ({
    profile,
    identityReady,
    legacyEmployee,
    markIdentityReady,
    applyOwner,
    applyEmployee,
    applyRemoteState,
    clearIdentity,
    clearLegacyIdentity,
    isGerant: profile.role === 'gerant' && profile.isOwner,
    canEditCatalog: profile.role === 'gerant' || profile.canEditCatalog,
    canAddProducts: profile.role === 'gerant' || profile.canAddProducts,
  }), [
    profile, identityReady, legacyEmployee, markIdentityReady, applyOwner,
    applyEmployee, applyRemoteState, clearIdentity, clearLegacyIdentity,
  ]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser must be used within UserProvider');
  return context;
}
