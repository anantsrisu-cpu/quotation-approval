import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

/** Microsoft 365 → Supabase → here: exchange the one-time code for a session cookie. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const nextParam = url.searchParams.get('next') || '/';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
  const providerError = url.searchParams.get('error_description') || url.searchParams.get('error');

  if (providerError) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(providerError)}`, url.origin));
  }
  if (code) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin));
  }
  return NextResponse.redirect(new URL('/login', url.origin));
}
