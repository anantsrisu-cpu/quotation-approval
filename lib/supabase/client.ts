'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function supabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || '';
}
export function supabaseKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
}

/** One browser client for the whole app (keeps the session in cookies). */
export function getSupabase(): SupabaseClient {
  if (!client) client = createBrowserClient(supabaseUrl(), supabaseKey());
  return client;
}
