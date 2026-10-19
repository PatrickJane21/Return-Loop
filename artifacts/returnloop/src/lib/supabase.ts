import { createClient } from '@supabase/supabase-js';

// These two values come from your Supabase project (Project Settings -> API / Data API).
// Only the PUBLIC "publishable" (anon) key belongs in website code.
// NEVER put a "secret" or "service_role" key here: the browser can read everything in this file.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true },
});