'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import { ROLE_TH, dt } from '@/lib/format';
import { Loading } from './ui';

function NavLink({ href, th, en, count, exact }: { href: string; th: string; en: string; count?: number; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(href + '/');
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}>
      <span>{th}<span className="sub">{en}</span></span>
      {!!count && <span className="cnt">{count}</span>}
    </Link>
  );
}

function Bell() {
  const { notifs, unread, markRead } = useApp();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const top = notifs.slice(0, 8);
  const g = (k: string) => (k === 'ok' ? 'ok' : k === 'bad' ? 'bad' : 'wait');
  return (
    <>
      <button className="bell" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`การแจ้งเตือน ${unread} รายการใหม่ · Notifications, ${unread} new`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <>
          <button className="pop-scrim" onClick={() => setOpen(false)} aria-label="ปิดการแจ้งเตือน · Close notifications" />
          <div className="pop" role="dialog" aria-label="การแจ้งเตือน · Notifications">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px' }}>
              <b style={{ flex: 1, fontSize: 16 }}>การแจ้งเตือน · Notifications</b>
              <button className="btn sm" onClick={() => markRead()}>อ่านทั้งหมด · Mark read</button>
            </div>
            {top.length ? (
              top.map((n) => (
                <button
                  key={n.id}
                  className={`ni${n.read_at ? '' : ' unread'}`}
                  onClick={() => {
                    markRead([n.id]);
                    setOpen(false);
                    router.push(n.link || '/notifications');
                  }}
                >
                  <span className={`g ${g(n.kind)}`}>{n.kind === 'ok' ? '✓' : n.kind === 'bad' ? '!' : '…'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontWeight: n.read_at ? 500 : 700, fontSize: 14 }}>{n.title}</b>
                    <span className="note" style={{ display: 'block' }}>{n.body} · {dt(n.created_at)}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className="note" style={{ padding: '0 16px 16px', margin: 0 }}>ยังไม่มีการแจ้งเตือน · No notifications yet</p>
            )}
            <div style={{ borderTop: '1px solid var(--line)', padding: 12, textAlign: 'center' }}>
              <Link href="/notifications" onClick={() => setOpen(false)}>ดูการแจ้งเตือนทั้งหมด · See all notifications →</Link>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { ready, me, has, waitingCount, sb } = useApp();
  const path = usePathname();
  const router = useRouter();
  const active = me?.status === 'active';

  // account gate: anyone not yet active goes to the application page
  useEffect(() => {
    if (!ready || !me) return;
    if (!active && path !== '/apply') router.replace('/apply');
    if (active && path === '/apply') router.replace('/');
  }, [ready, me, active, path, router]);

  async function signOut() {
    await sb.auth.signOut();
    window.location.href = '/login';
  }

  if (!ready) {
    return (
      <div className="main" style={{ maxWidth: 900, margin: '0 auto' }}>
        <Loading rows={4} />
      </div>
    );
  }
  if (!me) {
    return (
      <div className="center-page">
        <div className="login-card">
          <h1>ไม่พบบัญชีผู้ใช้</h1>
          <p className="lead">Your profile could not be loaded. Sign out and sign in again, or contact the admin.</p>
          <button className="btn p" onClick={signOut}>ออกจากระบบ · Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="top">
        <Link href="/" className="brand" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="logo" aria-hidden="true">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h7l5 5v13H7z" /><path d="M10 14l2 2 4-4" /></svg>
          </span>
          <span><b>ระบบอนุมัติใบเสนอราคา</b><small>Quotation Approval</small></span>
        </Link>
        <span className="user">
          <span><b>{me.name || me.email}</b>{active && me.roles.length > 0 && <> · {me.roles.map((r) => ROLE_TH[r]).join('/')}</>}</span>
        </span>
        {active && <Bell />}
        <button className="out" onClick={signOut}>ออกจากระบบ · Sign out</button>
      </header>
      <div className="shell">
        {active && (
          <nav className="nav" aria-label="เมนู · Menu">
            {has('preparer') && (
              <div>
                <h3>ผู้จัดทำ · PREPARER</h3>
                <NavLink href="/requests" th="คำขอของฉัน" en="My requests" exact />
                <NavLink href="/requests/new" th="สร้างคำขอใหม่" en="New request" />
              </div>
            )}
            {has('approver') && (
              <div>
                <h3>ผู้อนุมัติ · APPROVER</h3>
                <NavLink href="/inbox" th="รอฉันอนุมัติ" en="Approval inbox" count={waitingCount} />
              </div>
            )}
            <div>
              <h3>ทั่วไป · GENERAL</h3>
              <NavLink href="/history" th="ประวัติและค้นหา" en="History & search" />
              <NavLink href="/notifications" th="การแจ้งเตือน" en="Notifications" />
              <NavLink href="/profile" th="บัญชีและลายเซ็นของฉัน" en="My account & signature" />
            </div>
            {has('admin') && (
              <div>
                <h3>ผู้ดูแลระบบ · ADMIN</h3>
                <NavLink href="/admin" th="ภาพรวมและควบคุมคำขอ" en="Overview & process control" exact />
                <NavLink href="/admin/applications" th="คำขอเปิดบัญชี" en="Account applications" />
                <NavLink href="/admin/users" th="บัญชีและลายเซ็น" en="Accounts & signatures" />
                <NavLink href="/admin/settings" th="ตั้งค่าระบบ" en="Application settings" />
                <NavLink href="/admin/products" th="รายการสินค้า SKU" en="SKU product list" />
                <NavLink href="/admin/errors" th="สถานะปัญหา" en="Bug & issue status" />
                <NavLink href="/admin/view-as" th="ดูมุมมองผู้ใช้" en="View as user" />
              </div>
            )}
          </nav>
        )}
        <main className="main">{children}</main>
      </div>
    </>
  );
}
