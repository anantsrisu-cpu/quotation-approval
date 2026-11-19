'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { dt } from '@/lib/format';

/**
 * ปิดปรับปรุงระบบ · Maintenance mode (SQL 0019, app_settings.maintenance).
 * While it is on, everyone who is not an admin sees a "closed for maintenance" screen
 * on top of the page they were on; what they typed stays underneath and comes back
 * when the system reopens (the database also refuses their changes meanwhile).
 * Admins keep working and see a reminder bar.
 */

const CHECK_MS = 30_000;

interface M { on: boolean; msg: string; at: string | null }

export function MaintenanceGate() {
  const { sb, settings, has, me, refresh } = useApp();
  const admin = has('admin');
  const pick = (s: typeof settings): M => ({ on: !!s?.maintenance, msg: s?.maintenance_msg || '', at: s?.maintenance_at || null });
  const [m, setM] = useState<M>(() => pick(settings));
  const [reopened, setReopened] = useState(false);
  const was = useRef(m.on);

  // the settings page saves through the shared settings: follow them at once
  useEffect(() => { setM(pick(settings)); }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const check = useCallback(async () => {
    const { data, error } = await sb.from('app_settings').select('maintenance,maintenance_msg,maintenance_at').eq('id', 1).maybeSingle();
    if (error || !data) return; // SQL 0019 not run yet, or offline: leave as is
    setM({ on: !!data.maintenance, msg: data.maintenance_msg || '', at: data.maintenance_at || null });
  }, [sb]);

  // checked every 30 s and whenever the person comes back to the tab
  useEffect(() => {
    if (!me) return;
    const t = window.setInterval(check, CHECK_MS);
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', check);
    };
  }, [me, check]);

  // closed → open: the lists may be out of date and a new version may be live
  useEffect(() => {
    if (was.current && !m.on && !admin) {
      setReopened(true);
      refresh();
    }
    was.current = m.on;
  }, [m.on, admin, refresh]);

  if (m.on && admin) {
    return (
      <div className="mnt-bar" role="status" id="mnt-admin-bar">
        <span>🔧 <b>ปิดปรับปรุงระบบอยู่</b> — ผู้ใช้อื่นใช้งานไม่ได้ (คุณใช้ได้เพราะเป็นผู้ดูแล) · Maintenance mode is on</span>
        <Link className="btn sm" href="/admin/settings#maintenance">เปิดระบบ / ตั้งค่า · Reopen</Link>
      </div>
    );
  }
  if (m.on) {
    return (
      <div className="mnt-overlay" role="alertdialog" aria-modal="true" aria-labelledby="mnt-title" id="mnt-overlay">
        <div className="mnt-card">
          <div className="mnt-icon" aria-hidden="true">🔧</div>
          <h1 id="mnt-title">ระบบปิดปรับปรุงชั่วคราว</h1>
          <p className="lead" style={{ margin: 0 }}>The system is closed for maintenance</p>
          {m.msg && <p className="mnt-msg">{m.msg}</p>}
          <p style={{ margin: 0 }}>
            ข้อมูลที่กรอกค้างไว้<b>ยังอยู่ อย่าปิดหรือรีเฟรชหน้านี้</b> เมื่อระบบเปิดแล้ว หน้าจอนี้จะหายไปเอง แล้วกดบันทึกหรือส่งต่อได้ตามปกติ
          </p>
          <span className="note">Don&apos;t close this page — your work is kept and this screen goes away when the system reopens. ตรวจสถานะทุก 30 วินาที{m.at ? ` · ปิดตั้งแต่ ${dt(m.at)}` : ''}</span>
          <button type="button" className="btn" onClick={check}>ตรวจอีกครั้ง · Check now</button>
        </div>
      </div>
    );
  }
  if (reopened) {
    return (
      <div className="mnt-bar ok" role="status" id="mnt-reopened">
        <span>✓ <b>ระบบเปิดใช้งานแล้ว</b> · ถ้ามีงานค้าง กดบันทึกก่อน แล้วโหลดหน้าใหม่เพื่อใช้เวอร์ชันล่าสุด · The system is back</span>
        <span className="row" style={{ gap: 8 }}>
          <button type="button" className="btn sm" onClick={() => window.location.reload()}>โหลดหน้าใหม่ · Reload</button>
          <button type="button" className="btn sm" onClick={() => setReopened(false)}>ปิด · Close</button>
        </span>
      </div>
    );
  }
  return null;
}
