'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useApp } from './AppProvider';
import { supabaseKey, supabaseUrl } from '@/lib/supabase/client';

/**
 * สถานะการเชื่อมต่อ (SQL 0024).
 * Reports this page to the database about once a minute (touch_presence) so admins see
 * who is online, and shows a dot by the person's name in the top bar:
 * green = connected · red = the connection dropped (no internet, or the server cannot be reached).
 */

const BEAT_MS = 45_000;
const RETRY_MS = 10_000;

export function PresenceDot() {
  const { sb, me } = useApp();
  const path = usePathname();
  const [up, setUp] = useState(true);
  const token = useRef('');
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (!me) return;
    let timer = 0;
    let stopped = false;
    const beat = async () => {
      window.clearTimeout(timer);
      let ok = navigator.onLine;
      if (ok) {
        try {
          const { data } = await sb.auth.getSession();
          token.current = data.session?.access_token || '';
          const { status } = await sb.rpc('touch_presence', { p_state: 'online', p_page: pathRef.current || '' });
          // any answer from the server counts as connected (a missing SQL 0024 answers 404 and is not an outage)
          ok = status > 0 && status < 500;
        } catch {
          ok = false;
        }
      }
      if (stopped) return;
      setUp(ok);
      timer = window.setTimeout(beat, ok ? BEAT_MS : RETRY_MS);
    };
    // the page is being closed: say so, so admins see "offline" rather than "connection dropped"
    const bye = () => {
      if (!token.current) return;
      try {
        fetch(`${supabaseUrl()}/rest/v1/rpc/touch_presence`, {
          method: 'POST', keepalive: true,
          headers: { apikey: supabaseKey(), Authorization: `Bearer ${token.current}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_state: 'closed' }),
        });
      } catch { /* nothing to do while closing */ }
    };
    const onOffline = () => { setUp(false); window.clearTimeout(timer); timer = window.setTimeout(beat, RETRY_MS); };
    const onOnline = () => beat();
    const onVisible = () => document.visibilityState === 'visible' && beat();
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', bye);
    document.addEventListener('visibilitychange', onVisible);
    beat();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', bye);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sb, me]);

  const label = up ? 'ออนไลน์ · เชื่อมต่อแล้ว · Online' : 'ขาดการเชื่อมต่อ (เน็ตหลุด) — งานบนหน้าจอยังอยู่ ระบบจะเชื่อมต่อใหม่เอง · Offline';
  return (
    <span className={`pres-me ${up ? 'on' : 'off'}`} role="status" title={label} id="pres-me">
      <span className="pres-dot" aria-hidden="true" />
      <span className={up ? 'sr' : 'pres-txt'}>{up ? label : 'ออฟไลน์ · เน็ตหลุด'}</span>
    </span>
  );
}

export type PresenceStatus = 'online' | 'lost' | 'offline' | 'never';
export interface PresenceRow { user_id: string; status: Exclude<PresenceStatus, 'never'>; last_seen: string; seconds_ago: number; since: string; page: string }

export const PRESENCE_TH: Record<PresenceStatus, string> = {
  online: 'ออนไลน์',
  lost: 'ขาดการเชื่อมต่อ (เน็ตหลุด)',
  offline: 'ออฟไลน์',
  never: 'ยังไม่มีข้อมูล',
};

/** "3 นาทีที่แล้ว" */
export function agoTh(sec: number) {
  if (sec < 60) return 'เมื่อสักครู่';
  if (sec < 3600) return `${Math.floor(sec / 60)} นาทีที่แล้ว`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ชั่วโมงที่แล้ว`;
  return `${Math.floor(sec / 86400)} วันที่แล้ว`;
}

/** Admins: everyone's status, refreshed every 30 s. null = SQL 0024 not run yet. */
export function usePresence() {
  const { sb } = useApp();
  const [rows, setRows] = useState<Record<string, PresenceRow> | null>({});
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const { data, error } = await sb.rpc('admin_presence');
      if (stop) return;
      if (error) return setRows(null);
      setRows(Object.fromEntries(((data as PresenceRow[]) || []).map((r) => [r.user_id, r])));
    };
    load();
    const t = window.setInterval(load, 30_000);
    return () => { stop = true; window.clearInterval(t); };
  }, [sb]);
  return rows;
}
