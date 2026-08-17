import { createClient } from '@supabase/supabase-js';

// The Supabase project this dashboard authenticates against, as the default for
// a build with no VITE_SUPABASE_* set. The Vercel project does not set them, and
// since demo mode became opt-in below, a build without these credentials cannot
// sign anyone in at all -- it renders a login form with the submit button
// disabled. Same reasoning as PRODUCTION_ENGINE_URL in services/api.js: the
// deployment target has no environment configured, so the fallback has to be one
// that actually works.
//
// The anon key is public by design. It is compiled into the browser bundle on
// every build and identifies the project, nothing more; Row Level Security is
// what protects the data behind it (supabase/migrations/0001_init.sql). The
// service-role key must never appear here -- it lives in ml-engine/.env only.
const DEFAULT_SUPABASE_URL = 'https://tppwtosqxbmegrsazjpd.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwcHd0b3NxeGJtZWdyc2F6anBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2Nzc4MjQsImV4cCI6MjEwMjI1MzgyNH0.0KWF1lMlhnrBhHqinvHQ1_WOpjpadoHXBRDR8qVVWIQ';

const url = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Demo mode lets the dashboard be entered without authenticating.
 *
 * Opt-in, and deliberately so. It used to be on unless VITE_DEMO_MODE was
 * exactly "false", which meant a deployment that simply forgot to set it -- as
 * the Vercel project did -- accepted any email with any password and reported a
 * successful sign-in. A missing environment variable must not be able to unlock
 * a console. Set VITE_DEMO_MODE=true to allow the bypass.
 */
const demoEnvRaw = import.meta.env.VITE_DEMO_MODE;
export const isDemoMode = String(demoEnvRaw).toLowerCase() === 'true';

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
