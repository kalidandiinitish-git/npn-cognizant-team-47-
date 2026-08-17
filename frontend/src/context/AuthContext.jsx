import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isDemoMode, isSupabaseConfigured, supabase } from '../lib/supabaseClient';

const DEMO_STORAGE_KEY = 'fraudstream.demo-session';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // A recovery link signs the visitor in before they have chosen a new
  // password. Without this flag the app sees a valid session and redirects
  // straight into the console, so "Forgot password?" delivered a working link
  // that could never actually change a password.
  const [passwordRecovery, setPasswordRecovery] = useState(false);

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

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
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

  /**
   * Start a local demo session.
   *
   * Deliberately separate from signIn. Entering the demo is a choice the
   * visitor makes with the demo button; it must never be the consolation prize
   * for credentials that failed, or the console would report a successful
   * sign-in to someone who typed the wrong password.
   */
  const startDemoSession = useCallback((email, fullName) => {
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
      full_name: fullName || userEmail.split('@')[0],
      role: 'analyst',
    });
    return { session: demoSession, user: demoSession.user, demo: true };
  }, []);

  const enterDemoMode = useCallback(() => {
    if (!isDemoMode) {
      throw new Error('Demo mode is disabled on this deployment.');
    }
    return startDemoSession('demo@local', 'Demo Analyst');
  }, [startDemoSession]);

  const signIn = useCallback(
    async (email, password) => {
      if (supabase) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
        return data;
      }
      // No Supabase project to authenticate against. The demo session is the
      // only thing sign-in can mean here, rather than a silent downgrade.
      if (!isDemoMode) {
        throw new Error('Authentication is not configured on this deployment.');
      }
      return startDemoSession(email, null);
    },
    [startDemoSession],
  );

  const signUp = useCallback(
    async (email, password, fullName) => {
      if (supabase) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName || '' } },
        });
        if (error) throw new Error(error.message);
        return data;
      }
      if (!isDemoMode) {
        throw new Error('Account creation is not configured on this deployment.');
      }
      return startDemoSession(email, fullName);
    },
    [startDemoSession],
  );

  const resetPassword = useCallback(async (email) => {
    if (!supabase) {
      throw new Error('Password reset needs Supabase, which is not configured here.');
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    if (error) throw new Error(error.message);
    return true;
  }, []);

  /** Complete a recovery: set the new password on the session the link issued. */
  const updatePassword = useCallback(async (password) => {
    if (!supabase) {
      throw new Error('Password updates need Supabase, which is not configured here.');
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    setPasswordRecovery(false);
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
    setPasswordRecovery(false);
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
      passwordRecovery,
      signIn,
      signUp,
      signOut,
      resetPassword,
      updatePassword,
      enterDemoMode,
    };
  }, [
    session,
    profile,
    loading,
    passwordRecovery,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
    enterDemoMode,
  ]);

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
