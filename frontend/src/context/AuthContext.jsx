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

    if (!supabase) {
      if (isDemoMode && sessionStorage.getItem(DEMO_STORAGE_KEY) === 'active') {
        setSession({ user: { email: 'demo@local', id: 'demo-user' }, demo: true });
      }
      setLoading(false);
      return undefined;
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session || null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
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
    if (!supabase || !session || !session.user) {
      setProfile(null);
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
    if (!supabase) {
      if (!isDemoMode) {
        throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      }
      sessionStorage.setItem(DEMO_STORAGE_KEY, 'active');
      setSession({ user: { email: 'demo@local', id: 'demo-user' }, demo: true });
      return { demo: true };
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data;
  }, []);

  const signUp = useCallback(async (email, password, fullName) => {
    if (!supabase) {
      throw new Error('Supabase is not configured, so accounts cannot be created.');
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName || '' } },
    });
    if (error) throw new Error(error.message);
    return data;
  }, []);

  const resetPassword = useCallback(async (email) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    if (error) throw new Error(error.message);
    return true;
  }, []);

  const signOut = useCallback(async () => {
    sessionStorage.removeItem(DEMO_STORAGE_KEY);
    if (supabase) {
      await supabase.auth.signOut();
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
