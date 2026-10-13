'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { AdminGate } from '@/components/AdminGate';
import { Loading, PageHead } from '@/components/ui';
import { dt } from '@/lib/format';
import type { AppError } from '@/lib/types';

const ST_TH: Record<AppError['status'], [string, string]> = {
  open: ['เปิดอยู่ · Open', 'st-bad'],
  investigating: ['กำลังตรวจ · Investigating', 'st-pend'],
  fixed: ['แก้แล้ว · Fixed', 'st-ok'],
  ignored: ['ไม่ต้องแก้ · Ignored', 'st-draft'],
};

function Row({ e, onSaved }: { e: AppError; onSaved: () => void }) {
  const { sb, name, run, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(e.status);
  const [note, setNote] = useState(e.admin_note);
  async function save() {
    const { ok } = await run('update-error', sb.from('app_errors').update({ status, admin_note: note, updated_at: new Date().toISOString() }).eq('id', e.id));
    if (ok) { toast('ok', 'บันทึกแล้ว · Saved', ''); onSaved(); }
  }
  return (
    <div className="card" style={{ gap: 10 }}>
      <div className="actions">
        <div style={{ minWidth: 0 }}>
          <b style={{ overflowWrap: 'anywhere' }}>{e.message}</b>
          <div className="note">{dt(e.at)} · {e.user_id ? name(e.user_id) : '—'} · หน้า <span className="mono">{e.page || '—'}</span>{e.action && <> · การกระทำ <span className="mono">{e.action}</span></>}</div>
        </div>
        <span className={`chip ${ST_TH[e.status][1]}`}>{ST_TH[e.status][0]}</span>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'ซ่อนรายละเอียด' : 'รายละเอียด · Details'}</button>
        {e.user_id && <Link className="btn sm" href={`/admin/view-as?user=${e.user_id}`}>ดูมุมมองผู้ใช้คนนี้ · View as this user</Link>}
      </div>
      {open && (
        <>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'var(--soft)', borderRadius: 8, padding: 10, fontSize: 12, margin: 0, maxHeight: 260, overflow: 'auto' }}>{e.detail || '(no detail)'}{'\n\n'}{e.user_agent}</pre>
          <div className="grid">
            <label className="f">สถานะ · Status
              <select className="in" value={status} onChange={(x) => setStatus(x.target.value as AppError['status'])}>
                {(Object.keys(ST_TH) as AppError['status'][]).map((s) => <option key={s} value={s}>{ST_TH[s][0]}</option>)}
              </select>
            </label>
            <label className="f span2">บันทึกของผู้ดูแล · Admin note<input className="in" value={note} onChange={(x) => setNote(x.target.value)} /></label>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn p sm" onClick={save}>บันทึก · Save</button></div>
        </>
      )}
    </div>
  );
}

function Errors() {
  const { sb, bump, refresh } = useApp();
  const [list, setList] = useState<AppError[] | null>(null);
  const [st, setSt] = useState<'active' | AppError['status'] | 'all'>('active');
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      let q = sb.from('app_errors').select('*').order('at', { ascending: false }).limit(200);
      if (st === 'active') q = q.in('status', ['open', 'investigating']);
      else if (st !== 'all') q = q.eq('status', st);
      const { data } = await q;
      setList((data as AppError[]) || []);
      const keys: AppError['status'][] = ['open', 'investigating', 'fixed', 'ignored'];
      const res = await Promise.all(keys.map((k) => sb.from('app_errors').select('id', { count: 'exact', head: true }).eq('status', k)));
      const c: Record<string, number> = {};
      keys.forEach((k, i) => (c[k] = res[i].count || 0));
      setCounts(c);
    })();
  }, [sb, st, bump]);

  return (
    <>
      <PageHead title="สถานะปัญหาและข้อผิดพลาด" lead="Bug & issue status — errors people hit in the app are logged here automatically, with the page and action" />
      <div className="tiles">
        {(Object.keys(ST_TH) as AppError['status'][]).map((k) => <div key={k} className="tile"><span>{ST_TH[k][0]}</span><b>{counts[k] ?? '…'}</b></div>)}
      </div>
      <div className="row" style={{ gap: 8 }} role="group" aria-label="ตัวกรอง · Filter">
        {([['active', 'ยังไม่ปิด · Not closed'], ['open', 'เปิดอยู่'], ['investigating', 'กำลังตรวจ'], ['fixed', 'แก้แล้ว'], ['all', 'ทั้งหมด · All']] as const).map(([k, l]) => (
          <button key={k} className={`btn sm${st === k ? ' p' : ''}`} aria-pressed={st === k} onClick={() => setSt(k)}>{l}</button>
        ))}
      </div>
      <div className="box">
        ระบบบันทึกเมื่อ: หน้าแสดงผลไม่สำเร็จ, คำสั่งที่ส่งไปฐานข้อมูลล้มเหลวโดยไม่คาดคิด, สร้าง PDF ไม่สำเร็จ หรือเกิดข้อผิดพลาดในเบราว์เซอร์ · Logged when a page crashes, an unexpected database error occurs, a PDF cannot be built, or the browser throws an error. ข้อความแจ้งเตือนตามกฎ เช่น “กรอกข้อมูลไม่ครบ” จะไม่ถูกบันทึก · Normal validation messages are not logged.
      </div>
      {list === null ? <Loading /> : list.length ? list.map((e) => <Row key={e.id} e={e} onSaved={refresh} />) : (
        <div className="card"><p className="lead" style={{ margin: 0 }}>ไม่มีปัญหาในรายการนี้ · No issues here</p></div>
      )}
    </>
  );
}

export default function Page() {
  return <AdminGate><Errors /></AdminGate>;
}
