'use client';
import { getSupabase } from './supabase/client';

let lastKey = '';
let lastAt = 0;

/**
 * Send an error to the admin "bug status" page (table app_errors).
 * Never throws; de-duplicates bursts of the same error.
 */
export async function reportError(message: string, opts: { action?: string; detail?: string } = {}) {
  try {
    const key = message + '|' + (opts.action || '');
    const now = Date.now();
    if (key === lastKey && now - lastAt < 10000) return;
    lastKey = key;
    lastAt = now;
    const supabase = getSupabase();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    await supabase.from('app_errors').insert({
      user_id: data.user.id,
      page: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '',
      action: (opts.action || '').slice(0, 200),
      message: String(message).slice(0, 4000),
      detail: (opts.detail || '').slice(0, 20000),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 400) : '',
    });
  } catch {
    /* reporting must never break the app */
  }
}
