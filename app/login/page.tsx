'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase/client';

function LoginInner() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(params.get('error') || '');

  async function signIn() {
    setBusy(true);
    setErr('');
    const next = params.get('next') || '/';
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email',
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setErr(error.message);
      setBusy(false);
    }
  }

  return (
    <main className="center-page">
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/icon.svg" alt="" width={44} height={44} />
          <div>
            <h1 style={{ fontSize: 22 }}>ระบบอนุมัติใบเสนอราคา</h1>
            <p className="lead">Quotation Approval</p>
          </div>
        </div>
        <p style={{ margin: 0 }}>
          เข้าสู่ระบบด้วยบัญชี Microsoft 365 ของบริษัท ผู้ใช้ใหม่จะได้กรอกใบสมัครบัญชีหลังเข้าสู่ระบบครั้งแรก
          <span className="note" style={{ display: 'block' }}>
            Sign in with your company Microsoft 365 account. First-time users fill in a short account application.
          </span>
        </p>
        {err && (
          <div className="bad-box" role="alert">
            <b>เข้าสู่ระบบไม่สำเร็จ · Sign-in failed</b>
            <div style={{ fontSize: 13 }}>{err}</div>
          </div>
        )}
        <button className="ms-btn" onClick={signIn} disabled={busy}>
          <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#F25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
            <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
          </svg>
          {busy ? 'กำลังไปที่ Microsoft… · Redirecting…' : 'เข้าสู่ระบบด้วย Microsoft 365 · Sign in'}
        </button>
        <p className="note" style={{ margin: 0, textAlign: 'center' }}>
          หากเข้าไม่ได้ ติดต่อผู้ดูแลระบบหรือฝ่าย IT · Trouble signing in? Contact your admin or IT.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
