import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isDemoMode, isSupabaseConfigured, supabase } from '../lib/supabaseClient';

const DEMO_STORAGE_KEY = 'fraudstream.demo-session';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // ---- Supabase session bootstrap + subscription -------------------------
  useEffect(() => {
    let active = true;

    const restoreDemoSession = () => {
      const isStored =
        localStorage.getItem(DEMO_STORAGE_KEY) === 'active' ||
        sessionStorage.getItem(DEMO_STORAGE_KEY) === 'active';
      if (isDemoMode && isStored) {
        setSession({ user: { email: 'demo@local', id: 'demo-user' }, demo: true });
        setProfile({
          id: 'demo-user',
          email: 'demo@local',
          full_name: 'Demo Analyst',
          role: 'analyst',
        });
        return true;
      }
      return false;
    };

    if (!supabase) {
      restoreDemoSession();
      setLoading(false);
      return undefined;
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        if (data && data.session) {
          setSession(data.session);
        } else {
          const restored = restoreDemoSession();
          if (!restored) setSession(null);
        }
      })
      .catch(() => {
        if (!active) return;
        restoreDemoSession();
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession) {
        setSession(nextSession);
      } else if (!restoreDemoSession()) {
        setSession(null);
      }
    });

    return () => {
      active = false;
      if (subscription && subscription.subscription) {
        subscription.subscription.unsubscribe();
      }
    };
  }, []);

  // ---- Profile row (created by the on_auth_user_created trigger) ---------
  useEffect(() => {
    let active = true;
    if (!supabase || !session || !session.user || session.demo) {
      if (!session || !session.user) setProfile(null);
      return undefined;
    }
    supabase
      .from('profiles')
      .select('id, email, full_name, role, created_at')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setProfile(data || null);
      });
    return () => {
      active = false;
    };
  }, [session]);

  const signIn = useCallback(async (email, password) => {
    // If Supabase is configured and not using demo credentials, try real auth
    if (supabase && (!isDemoMode || (email !== 'demo@local' && password !== 'demo'))) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error) return data;
      // If error but in demo mode fallback, fall through to demo session
      if (!isDemoMode) throw new Error(error.message);
    }

    // Demo session fallback: allows instant sign-in with any email/password
    const userEmail = email || 'demo@local';
    const demoSession = {
      user: {
        email: userEmail,
        id: `demo-${userEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
      },
      demo: true,
    };
    localStorage.setItem(DEMO_STORAGE_KEY, 'active');
    sessionStorage.setItem(DEMO_STORAGE_KEY, 'active');
    setSession(demoSession);
    setProfile({
      id: demoSession.user.id,
      email: userEmail,
      full_name: userEmail.split('@')[0],
      role: 'analyst',
    });
    return { session: demoSession, demo: true };
  }, []);

  const signUp = useCallback(async (email, password, fullName) => {
    if (supabase) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName || '' } },
      });
      if (!error) return data;
      if (!isDemoMode) throw new Error(error.message);
    }

    // Demo sign-up fallback: instantly create a session and log the user in
    const userEmail = email || 'analyst@company.com';
    const displayName = fullName || userEmail.split('@')[0];
    const demoSession = {
      user: {
        email: userEmail,
        id: `demo-${userEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
      },
      demo: true,
    };
    localStorage.setItem(DEMO_STORAGE_KEY, 'active');
    sessionStorage.setItem(DEMO_STORAGE_KEY, 'active');
    setSession(demoSession);
    setProfile({
      id: demoSession.user.id,
      email: userEmail,
      full_name: displayName,
      role: 'analyst',
    });
    return { session: demoSession, user: demoSession.user, demo: true };
  }, []);

  const resetPassword = useCallback(async (email) => {
    if (supabase) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      });
      if (!error) return true;
      if (!isDemoMode) throw new Error(error.message);
    }
    return true;
  }, []);

  const signOut = useCallback(async () => {
    localStorage.removeItem(DEMO_STORAGE_KEY);
    sessionStorage.removeItem(DEMO_STORAGE_KEY);
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch (_error) {
        // ignore network error on sign-out
      }
    }
    setSession(null);
    setProfile(null);
  }, []);

  const value = useMemo(() => {
    const user = session ? session.user : null;
    const email = user ? user.email : null;
    const displayName =
      (profile && profile.full_name) || (email ? email.split('@')[0] : 'Analyst');
    return {
      session,
      user,
      profile,
      email,
      displayName,
      role: (profile && profile.role) || (session && session.demo ? 'demo' : 'analyst'),
      loading,
      isAuthenticated: Boolean(session),
      isDemoSession: Boolean(session && session.demo),
      supabaseConfigured: isSupabaseConfigured,
      demoModeAvailable: isDemoMode,
      signIn,
      signUp,
      signOut,
      resetPassword,
    };
  }, [session, profile, loading, signIn, signUp, signOut, resetPassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}

export default AuthContext;
