import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Demo mode lets the dashboard run against the API without requiring Supabase Auth.
 * Enabled by default unless explicitly disabled with VITE_DEMO_MODE=false.
 */
const demoEnvRaw = import.meta.env.VITE_DEMO_MODE;
export const isDemoMode = demoEnvRaw === undefined || String(demoEnvRaw).toLowerCase() !== 'false';

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: { eventsPerSecond: 20 },
      },
    })
  : null;

export const supabaseProjectUrl = url || '';
