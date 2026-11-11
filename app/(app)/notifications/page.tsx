'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Loading, PageHead } from '@/components/ui';
import { dt } from '@/lib/format';
import type { Notification } from '@/lib/types';

export default function NotificationsPage() {
  const { sb, uid, bump, markRead, clearNotifs, toast } = useApp();
  const [list, setList] = useState<Notification[] | null>(null);
  const [ask, setAsk] = useState(false);
  const [clearing, setClearing] = useState(false);
  async function clear() {
    setClearing(true);
    const n = await clearNotifs();
    setClearing(false);
    setAsk(false);
    if (n !== null) {
      setList([]);
      toast('ok', 'ลบการแจ้งเตือนแล้ว · Notifications cleared', `${n} รายการ`);
    }
  }
  const [only, setOnly] = useState<'all' | 'unread' | 'bad'>('all');

  useEffect(() => {
    if (!uid) return;
    let q = sb.from('notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(200);
    if (only === 'unread') q = q.is('read_at', null);
    if (only === 'bad') q = q.eq('kind', 'bad');
    q.then(({ data }) => setList((data as Notification[]) || []));
  }, [sb, uid, bump, only]);

  const g = (k: string) => (k === 'ok' ? 'ok' : k === 'bad' ? 'bad' : 'wait');
  return (
    <>
      <PageHead title="การแจ้งเตือนทั้งหมด" lead="All notifications — requests sent, approved, returned, or anything that needs attention">
        <button className="btn" onClick={async () => { await markRead(); setList((l) => (l || []).map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }))); }}>อ่านทั้งหมด · Mark all read</button>
        <button className="btn d" id="notif-clear-page" onClick={() => setAsk(true)} disabled={ask}>ลบทั้งหมด · Clear all</button>
      </PageHead>
      {ask && (
        <div className="clear-ask card" role="alert">
          <span>ลบการแจ้งเตือน<b>ทั้งหมด</b>ของคุณ (ทุกตัวกรอง)? คำขอและประวัติการอนุมัติไม่ถูกลบ · กู้คืนไม่ได้</span>
          <span className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={() => setAsk(false)} disabled={clearing}>ยกเลิก · Cancel</button>
            <button className="btn d" id="notif-clear-page-go" onClick={clear} disabled={clearing}>{clearing ? 'กำลังลบ…' : 'ลบทั้งหมด · Clear all'}</button>
          </span>
        </div>
      )}
      <div className="row" style={{ gap: 8 }} role="group" aria-label="ตัวกรอง · Filter">
        {([['all', 'ทั้งหมด · All'], ['unread', 'ยังไม่อ่าน · Unread'], ['bad', 'ปัญหา / ไม่อนุมัติ · Problems']] as const).map(([k, l]) => (
          <button key={k} className={`btn sm${only === k ? ' p' : ''}`} aria-pressed={only === k} onClick={() => setOnly(k)}>{l}</button>
        ))}
      </div>
      {list === null ? <Loading /> : (
        <div className="card" style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
          {list.length ? list.map((n) => (
            <Link key={n.id} href={n.link || '#'} className={`ni${n.read_at ? '' : ' unread'}`} style={{ textDecoration: 'none', color: 'inherit' }} onClick={() => !n.read_at && markRead([n.id])}>
              <span className={`g ${g(n.kind)}`}>{n.kind === 'ok' ? '✓' : n.kind === 'bad' ? '!' : '…'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontWeight: n.read_at ? 500 : 700 }}>{n.title}</b>
                <span className="note" style={{ display: 'block' }}>{n.body}</span>
                <span className="note" style={{ display: 'block' }}>{dt(n.created_at)}</span>
              </span>
            </Link>
          )) : <p className="note" style={{ padding: 20, margin: 0 }}>ไม่มีการแจ้งเตือน · No notifications</p>}
        </div>
      )}
    </>
  );
}
