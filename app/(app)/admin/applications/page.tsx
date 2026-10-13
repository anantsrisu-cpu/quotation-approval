'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { AdminGate } from '@/components/AdminGate';
import { Loading, PageHead } from '@/components/ui';
import { ROLE_TH, dt } from '@/lib/format';
import type { Profile, Role } from '@/lib/types';

function AppCard({ p, onDone }: { p: Profile; onDone: () => void }) {
  const { sb, departments, positions, run, toast, deptTh } = useApp();
  const [roles, setRoles] = useState<Role[]>(p.requested_roles.length ? p.requested_roles : ['preparer']);
  const [pos, setPos] = useState('');
  const [dept, setDept] = useState(p.dept || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (r: Role) => setRoles((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]));

  async function decide(approve: boolean) {
    if (approve && roles.includes('approver') && !pos) return toast('bad', 'เลือกตำแหน่งอนุมัติ · Choose an approver position', '');
    if (!approve && !note.trim()) return toast('bad', 'ระบุเหตุผลที่ไม่อนุมัติ · Give a reason', 'ผู้สมัครจะเห็นข้อความนี้ · The applicant will see it');
    setBusy(true);
    const { ok } = await run('admin_review_application', sb.rpc('admin_review_application', {
      p_user: p.id, p_approve: approve, p_roles: roles, p_position: roles.includes('approver') ? pos : null, p_dept: dept, p_note: note.trim(),
    }));
    setBusy(false);
    if (ok) {
      toast('ok', approve ? 'เปิดใช้งานบัญชีแล้ว · Account activated' : 'ปฏิเสธใบสมัครแล้ว · Application declined', p.name);
      onDone();
    }
  }

  return (
    <div className="card" style={{ border: '2px solid var(--tan)' }}>
      <div className="actions">
        <div>
          <h2>{p.name || p.email}</h2>
          <span className="note">{p.email} · สมัครเมื่อ {dt(p.applied_at)}</span>
        </div>
        <span className="chip st-pend">รอตรวจ · Pending</span>
      </div>
      <dl className="kv">
        <div><dt>ตำแหน่งงาน · Job title</dt><dd>{p.title || '—'}</dd></div>
        <div><dt>ฝ่าย · Department</dt><dd>{deptTh(p.dept)}</dd></div>
        <div><dt>บทบาทที่ขอ · Requested</dt><dd>{p.requested_roles.map((r) => ROLE_TH[r]).join(', ')}</dd></div>
        <div><dt>หมายเหตุ · Note</dt><dd>{p.apply_note || '—'}</dd></div>
      </dl>
      <div className="grid">
        <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend style={{ fontSize: 14, fontWeight: 500, padding: 0 }}>บทบาทที่ให้ · Roles to grant</legend>
          {(['preparer', 'approver', 'admin'] as Role[]).map((r) => (
            <label key={r} className="check"><input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} />{ROLE_TH[r]}</label>
          ))}
        </fieldset>
        <label className="f">ตำแหน่งอนุมัติ · Approver position {roles.includes('approver') && <span className="req">*</span>}
          <select className="in" value={pos} disabled={!roles.includes('approver')} onChange={(e) => setPos(e.target.value)}>
            <option value="">— เลือก · Select —</option>
            {positions.map((x) => <option key={x.code} value={x.code}>{x.th} · {x.en}</option>)}
          </select>
        </label>
        <label className="f">ฝ่าย · Department
          <select className="in" value={dept} onChange={(e) => setDept(e.target.value)}>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.th}</option>)}
          </select>
        </label>
        <label className="f">หมายเหตุถึงผู้สมัคร · Note to applicant
          <input className="in" value={note} onChange={(e) => setNote(e.target.value)} placeholder="บังคับเมื่อไม่อนุมัติ · Required to decline" />
        </label>
      </div>
      <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn d" disabled={busy} onClick={() => decide(false)}>ไม่อนุมัติ · Decline</button>
        <button className="btn p" disabled={busy || !roles.length} onClick={() => decide(true)}>✓ อนุมัติและเปิดใช้งาน · Approve & activate</button>
      </div>
      {roles.includes('approver') && <span className="note">อย่าลืมเพิ่มลายเซ็นให้ผู้อนุมัติ หรือให้เขาวาดเองในหน้า “บัญชีและลายเซ็นของฉัน” · Approvers need a signature before they can sign.</span>}
    </div>
  );
}

function Applications() {
  const { sb, bump, reloadRefs, refresh } = useApp();
  const [pending, setPending] = useState<Profile[] | null>(null);
  const [recent, setRecent] = useState<Profile[]>([]);

  useEffect(() => {
    (async () => {
      const [a, b] = await Promise.all([
        sb.from('profiles').select('*').eq('status', 'pending').order('applied_at'),
        sb.from('profiles').select('*').in('status', ['active', 'rejected']).not('reviewed_at', 'is', null).order('reviewed_at', { ascending: false }).limit(15),
      ]);
      setPending((a.data as Profile[]) || []);
      setRecent((b.data as Profile[]) || []);
    })();
  }, [sb, bump]);

  const done = async () => {
    await reloadRefs();
    refresh();
  };

  return (
    <>
      <PageHead title="คำขอเปิดบัญชี" lead="Account applications — people who signed in with Microsoft 365 and asked for access" />
      <div className="box">
        ขั้นตอน · Flow: <b>1</b> ผู้ใช้เข้าสู่ระบบด้วย Microsoft 365 → <b>2</b> กรอกใบสมัคร เลือกเป็นผู้จัดทำ/ผู้อนุมัติ → <b>3</b> ผู้ดูแลตรวจที่หน้านี้ กำหนดบทบาทและตำแหน่ง → <b>4</b> บัญชีเปิดใช้งาน ผู้ใช้ได้รับแจ้งทันที
      </div>
      {pending === null ? <Loading /> : pending.length ? (
        pending.map((p) => <AppCard key={p.id} p={p} onDone={done} />)
      ) : (
        <div className="card"><p className="lead" style={{ margin: 0 }}>ไม่มีใบสมัครรอตรวจ · No applications waiting</p></div>
      )}
      <h2>ตรวจแล้วล่าสุด · Recently reviewed</h2>
      <div className="tw">
        <table className="t" style={{ minWidth: 620 }}>
          <thead><tr><th>ชื่อ · Name</th><th>ผล · Result</th><th>บทบาท · Roles</th><th>วันที่ · Date</th><th>หมายเหตุ · Note</th></tr></thead>
          <tbody>
            {recent.map((p) => (
              <tr key={p.id}>
                <td><b style={{ fontWeight: 500 }}>{p.name}</b><div className="note">{p.email}</div></td>
                <td>{p.status === 'active' ? <span className="chip st-ok">อนุมัติ · Approved</span> : <span className="chip st-bad">ไม่อนุมัติ · Declined</span>}</td>
                <td>{p.roles.map((r) => ROLE_TH[r]).join(', ') || '—'}</td>
                <td>{dt(p.reviewed_at)}</td>
                <td>{p.review_note || '—'}</td>
              </tr>
            ))}
            {!recent.length && <tr><td colSpan={5} className="note">ยังไม่มี · None yet</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function Page() {
  return <AdminGate><Applications /></AdminGate>;
}
