import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Demo mode lets the dashboard run against the local API without Supabase
 * credentials. It is opt-in, defaults to off, and must stay off anywhere that is
 * reachable from the internet.
 */
export const isDemoMode =
  !isSupabaseConfigured && String(import.meta.env.VITE_DEMO_MODE).toLowerCase() === 'true';

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
