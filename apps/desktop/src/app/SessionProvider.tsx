import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { Capability, Organization, OrganizationMember, Role } from '@crafcube/types';
import { can } from '@crafcube/types';
import { supabase } from '@/lib/supabase';

/** A membership row joined with its organization, as the org switcher needs it. */
export interface Membership extends OrganizationMember {
  organization: Organization;
}

interface SessionValue {
  loading: boolean;
  session: Session | null;
  user: User | null;
  memberships: Membership[];
  activeOrg: Organization | null;
  role: Role | null;
  can: (capability: Capability) => boolean;
  switchOrg: (organizationId: string) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

const ACTIVE_ORG_KEY = 'crafcube.activeOrganizationId';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_ORG_KEY),
  );

  const loadMemberships = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setMemberships([]);
      return;
    }
    const { data, error } = await supabase
      .from('organization_members')
      .select('*, organization:organizations(*)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to load memberships', error);
      setMemberships([]);
      return;
    }
    setMemberships((data ?? []) as unknown as Membership[]);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      await loadMemberships(data.session?.user.id);
      if (!cancelled) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void loadMemberships(next?.user.id);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadMemberships]);

  // Keep the stored selection valid: fall back to the first membership.
  const activeMembership = useMemo(() => {
    if (memberships.length === 0) return null;
    return memberships.find((m) => m.organization_id === activeOrgId) ?? memberships[0];
  }, [memberships, activeOrgId]);

  const switchOrg = useCallback((organizationId: string) => {
    localStorage.setItem(ACTIVE_ORG_KEY, organizationId);
    setActiveOrgId(organizationId);
  }, []);

  const refresh = useCallback(async () => {
    await loadMemberships(session?.user.id);
  }, [loadMemberships, session?.user.id]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    localStorage.removeItem(ACTIVE_ORG_KEY);
    setActiveOrgId(null);
  }, []);

  const role = activeMembership?.role ?? null;

  const value = useMemo<SessionValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      memberships,
      activeOrg: activeMembership?.organization ?? null,
      role,
      can: (capability: Capability) => can(role, capability),
      switchOrg,
      refresh,
      signOut,
    }),
    [loading, session, memberships, activeMembership, role, switchOrg, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
