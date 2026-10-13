'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/components/AppProvider';
import { AdminGate } from '@/components/AdminGate';
import { Chip, Loading, PageHead } from '@/components/ui';
import { ROLE_TH, dt, fmt } from '@/lib/format';
import type { Profile, RequestStatus } from '@/lib/types';

interface Overview {
  profile: Profile;
  has_signature: boolean;
  my_requests: { id: string; no: string | null; status: RequestStatus; product_name: string; total: number; created_at: string; current_step: number }[];
  waiting: { id: string; no: string; product_name: string; total: number; step_since: string }[];
  notifications: { id: number; kind: string; title: string; body: string; link: string; read_at: string | null; created_at: string }[];
  errors: { id: number; at: string; page: string; action: string; message: string; status: string }[];
}

function ViewAs() {
  const { sb, people, deptTh, posTh, run } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const uid = params.get('user') || '';
  const [ov, setOv] = useState<Overview | null | undefined>(undefined);

  useEffect(() => {
    if (!uid) { setOv(undefined); return; }
    setOv(null);
    run<Overview>('admin_user_overview', sb.rpc('admin_user_overview', { p_user: uid })).then(({ data }) => setOv(data || undefined));
  }, [uid, sb, run]);

  const list = Object.values(people).sort((a, b) => a.name.localeCompare(b.name));
  const p = ov?.profile;
  const issues: string[] = [];
  if (p) {
    if (p.status !== 'active') issues.push(`บัญชียังไม่เปิดใช้งาน (สถานะ ${p.status}) ผู้ใช้จะเห็นเพียงหน้าใบสมัคร · Account not active: the user only sees the application page`);
    if (p.roles.includes('approver') && !p.position) issues.push('เป็นผู้อนุมัติแต่ยังไม่มีตำแหน่งอนุมัติ จะไม่ถูกเลือกเป็นผู้อนุมัติ · Approver without a position is never picked');
    if (p.roles.includes('approver') && !ov?.has_signature) issues.push('ผู้อนุมัติยังไม่มีลายเซ็น จะกดอนุมัติไม่ได้จนกว่าจะวาดลายเซ็น · No signature: approving will ask them to draw one first');
    if (!p.roles.length && p.status === 'active') issues.push('ไม่มีบทบาท จะเห็นเฉพาะประวัติ · No roles: only sees history');
    if (!p.dept) issues.push('ยังไม่ได้ระบุฝ่าย · No department set');
  }

  return (
    <>
      <PageHead title="ดูมุมมองผู้ใช้" lead="View as user — see what a person sees (their requests, inbox, notifications and errors) to help when they report a problem" />
      <div className="card">
        <label className="f">เลือกผู้ใช้ · Choose a person
          <select className="in" value={uid} onChange={(e) => router.replace(`/admin/view-as?user=${e.target.value}`)}>
            <option value="">— เลือก · Select —</option>
            {list.map((x) => <option key={x.id} value={x.id}>{x.name || x.email} · {x.email}</option>)}
          </select>
        </label>
        <span className="note">อ่านอย่างเดียว ไม่ได้เข้าสู่ระบบแทนผู้ใช้ · Read-only; you are not signed in as them.</span>
      </div>
      {uid && ov === null && <Loading rows={4} />}
      {p && ov && (
        <>
          <div className="card" style={{ border: '2px solid var(--brown)' }}>
            <div className="actions">
              <div><h2>{p.name || p.email}</h2><span className="note">{p.email} · {deptTh(p.dept)} · {p.title || '—'}</span></div>
              <span className="chip st-draft">{p.status}</span>
            </div>
            <dl className="kv">
              <div><dt>บทบาท · Roles</dt><dd>{p.roles.map((r) => ROLE_TH[r]).join(', ') || '—'}</dd></div>
              <div><dt>ตำแหน่งอนุมัติ · Position</dt><dd>{p.position ? posTh(p.position) : '—'}</dd></div>
              <div><dt>ลายเซ็น · Signature</dt><dd>{ov.has_signature ? '✓ มี' : '— ยังไม่มี'}</dd></div>
              <div><dt>สมัครเมื่อ · Applied</dt><dd>{dt(p.applied_at)}</dd></div>
            </dl>
            {issues.length > 0 ? (
              <div className="warn-box"><b>สิ่งที่อาจทำให้ผู้ใช้ติดขัด · Possible blockers</b><ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>{issues.map((x) => <li key={x}>{x}</li>)}</ul></div>
            ) : <div className="ok-box">✓ ไม่พบปัญหาการตั้งค่าบัญชี · No account setup problems found</div>}
            <Link className="btn sm" href="/admin/users" style={{ alignSelf: 'flex-start' }}>แก้ไขบัญชีนี้ · Edit account</Link>
          </div>
          <div className="row">
            <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card">
                <h2>รอผู้ใช้นี้อนุมัติ · Waiting for them ({ov.waiting.length})</h2>
                {ov.waiting.length ? ov.waiting.map((w) => (
                  <Link key={w.id} href={`/requests/${w.id}`} className="file-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <span className="mono note">{w.no}</span><span className="nm">{w.product_name}</span><span className="num">{fmt(w.total)}</span><span className="note">ตั้งแต่ {dt(w.step_since)}</span>
                  </Link>
                )) : <span className="note">ไม่มี · None</span>}
              </div>
              <div className="card">
                <h2>คำขอที่ผู้ใช้สร้าง · Their requests</h2>
                {ov.my_requests.length ? ov.my_requests.map((r) => (
                  <Link key={r.id} href={`/requests/${r.id}`} className="file-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <span className="mono note">{r.no || 'ร่าง'}</span><span className="nm">{r.product_name || '—'}</span><span className="num">{fmt(r.total)}</span><Chip status={r.status} />
                  </Link>
                )) : <span className="note">ไม่มี · None</span>}
              </div>
            </div>
            <div className="side" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card">
                <h2>ข้อผิดพลาดที่ผู้ใช้เจอ · Errors they hit</h2>
                {ov.errors.length ? ov.errors.map((e) => (
                  <div key={e.id} className="bad-box" style={{ fontSize: 13 }}><b>{e.message}</b><div>{dt(e.at)} · {e.page} {e.action && `· ${e.action}`} · {e.status}</div></div>
                )) : <span className="note">ไม่มี · None</span>}
                <Link href="/admin/errors" className="note">สถานะปัญหาทั้งหมด →</Link>
              </div>
              <div className="card">
                <h2>การแจ้งเตือนที่ผู้ใช้เห็น · Their notifications</h2>
                {ov.notifications.length ? ov.notifications.map((n) => (
                  <div key={n.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                    <b style={{ fontWeight: n.read_at ? 500 : 700, fontSize: 14 }}>{n.title}</b>
                    <div className="note">{n.body} · {dt(n.created_at)}{n.read_at ? ' · อ่านแล้ว' : ' · ยังไม่อ่าน'}</div>
                  </div>
                )) : <span className="note">ไม่มี · None</span>}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function Page() {
  return (
    <AdminGate>
      <Suspense fallback={<Loading />}><ViewAs /></Suspense>
    </AdminGate>
  );
}
