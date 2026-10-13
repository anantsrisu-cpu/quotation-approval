'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { AdminGate } from '@/components/AdminGate';
import { SignaturePad, imageToSignature, type PadHandle } from '@/components/SignaturePad';
import { PageHead } from '@/components/ui';
import { ROLE_TH } from '@/lib/format';
import type { Profile, ProfileStatus, Role } from '@/lib/types';

const STATUS_TH: Record<ProfileStatus, string> = { new: 'ยังไม่สมัคร', pending: 'รอตรวจ', active: 'ใช้งาน', rejected: 'ไม่อนุมัติ', disabled: 'ปิดใช้งาน' };

function Editor({ p, hasSig, onSaved }: { p: Profile; hasSig: boolean; onSaved: () => void }) {
  const { sb, uid, departments, positions, run, toast } = useApp();
  const [e, setE] = useState<Profile>(p);
  const [sig, setSig] = useState<string | null | undefined>(undefined);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pad = useRef<PadHandle>(null);
  const self = p.id === uid;

  useEffect(() => {
    setE(p);
    setPending(null);
    setSig(undefined);
    sb.from('signatures').select('data').eq('user_id', p.id).maybeSingle().then(({ data }) => setSig(data?.data || null));
  }, [p, sb]);

  const toggle = (r: Role) => setE((x) => ({ ...x, roles: x.roles.includes(r) ? x.roles.filter((y) => y !== r) : [...x.roles, r] }));

  async function save() {
    if (!e.name.trim()) return toast('bad', 'กรอกชื่อ · Name required', '');
    if (e.roles.includes('approver') && !e.position) return toast('bad', 'ผู้อนุมัติต้องมีตำแหน่งอนุมัติ · Approvers need a position', '');
    if (self && (!e.roles.includes('admin') || e.status !== 'active')) return toast('bad', 'ห้ามถอดสิทธิ์ผู้ดูแลของตัวเอง · You cannot remove your own admin access', 'ให้ผู้ดูแลคนอื่นทำแทน · Ask another admin');
    setBusy(true);
    const { ok } = await run('admin-save-user', sb.from('profiles').update({
      name: e.name.trim(), title: e.title.trim(), dept: e.dept || null, roles: e.roles,
      position: e.roles.includes('approver') ? e.position || null : null, status: e.status,
    }).eq('id', p.id));
    let sigOk = true;
    const newSig = pending || pad.current?.getData();
    if (ok && newSig) {
      const r = await run('admin-save-signature', sb.from('signatures').upsert({ user_id: p.id, data: newSig, updated_by: uid, updated_at: new Date().toISOString() }));
      sigOk = r.ok;
      if (r.ok) setSig(newSig);
    }
    setBusy(false);
    if (ok && sigOk) {
      toast('ok', 'บันทึกบัญชีแล้ว · Account saved', e.name);
      setPending(null);
      pad.current?.clear();
      onSaved();
    }
  }
  async function removeSig() {
    const { ok } = await run('admin-remove-signature', sb.from('signatures').delete().eq('user_id', p.id));
    if (ok) {
      setSig(null);
      toast('ok', 'ลบลายเซ็นแล้ว · Signature removed', '');
      onSaved();
    }
  }

  return (
    <form className="card" style={{ border: '2px solid var(--brown)' }} noValidate onSubmit={(ev) => ev.preventDefault()}>
      <h2>แก้ไข: {p.name || p.email}</h2>
      <span className="note">{p.email}</span>
      <label className="f" htmlFor="u-name">ชื่อ-นามสกุล · Name <span className="req">*</span>
        <input className="in" id="u-name" value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} />
      </label>
      <label className="f" htmlFor="u-title">ตำแหน่งงาน · Job title
        <input className="in" id="u-title" value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} />
      </label>
      <label className="f" htmlFor="u-dept">ฝ่าย · Department
        <select className="in" id="u-dept" value={e.dept || ''} onChange={(x) => setE({ ...e, dept: x.target.value || null })}>
          <option value="">—</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.th}</option>)}
        </select>
      </label>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend style={{ fontSize: 14, fontWeight: 500, padding: 0 }}>บทบาท · Roles</legend>
        {(['preparer', 'approver', 'admin'] as Role[]).map((r) => (
          <label key={r} className="check"><input type="checkbox" checked={e.roles.includes(r)} onChange={() => toggle(r)} />{ROLE_TH[r]}</label>
        ))}
      </fieldset>
      <label className="f" htmlFor="u-pos">ตำแหน่งผู้อนุมัติ · Approver position
        <select className="in" id="u-pos" value={e.position || ''} disabled={!e.roles.includes('approver')} onChange={(x) => setE({ ...e, position: x.target.value || null })}>
          <option value="">— ไม่ใช่ผู้อนุมัติ —</option>
          {positions.map((x) => <option key={x.code} value={x.code}>{x.th} · {x.en}</option>)}
        </select>
      </label>
      <label className="f" htmlFor="u-st">สถานะบัญชี · Account status
        <select className="in" id="u-st" value={e.status} onChange={(x) => setE({ ...e, status: x.target.value as ProfileStatus })}>
          {(['active', 'disabled', 'pending', 'rejected', 'new'] as ProfileStatus[]).map((s) => <option key={s} value={s}>{STATUS_TH[s]} · {s}</option>)}
        </select>
      </label>
      <div className="f" style={{ fontSize: 14, fontWeight: 500 }}>ลายเซ็น · Signature
        {sig === undefined ? <div className="skeleton" /> : sig ? (
          <>
            <div className="sig-box"><img className="sig-img" src={sig} alt="ลายเซ็นปัจจุบัน" /></div>
            <span className="note" style={{ fontWeight: 400 }}>วาดหรืออัปโหลดใหม่ด้านล่างเพื่อเปลี่ยน · Draw or upload below to replace</span>
          </>
        ) : <span className="note" style={{ fontWeight: 400, color: hasSig ? undefined : 'var(--bad)' }}>ยังไม่มีลายเซ็น · No signature yet</span>}
        {pending ? <div className="sig-box"><img className="sig-img" src={pending} alt="ลายเซ็นที่อัปโหลด" /></div> : <SignaturePad ref={pad} label="วาดลายเซ็น · Draw signature" />}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn sm" onClick={() => { pad.current?.clear(); setPending(null); }}>ล้าง · Clear</button>
          <label className="btn sm" style={{ cursor: 'pointer' }}>อัปโหลดรูป · Upload image
            <input type="file" accept="image/*" className="sr" onChange={async (x) => {
              const f = x.target.files?.[0];
              x.target.value = '';
              if (!f) return;
              try { setPending(await imageToSignature(f)); } catch (err: any) { toast('bad', err.message); }
            }} />
          </label>
          {sig && <button type="button" className="btn sm d" onClick={removeSig}>ลบลายเซ็น · Remove</button>}
        </div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <Link className="btn" href={`/admin/view-as?user=${p.id}`}>ดูมุมมองผู้ใช้ · View as user</Link>
        <button type="button" className="btn p" style={{ flex: 1 }} disabled={busy} onClick={save}>{busy ? 'กำลังบันทึก…' : 'บันทึก · Save'}</button>
      </div>
    </form>
  );
}

function Users() {
  const { sb, people, reloadRefs, bump, deptTh, posTh } = useApp();
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [st, setSt] = useState<'all' | ProfileStatus>('active');
  const [sigIds, setSigIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    sb.from('signatures').select('user_id').then(({ data }) => setSigIds(new Set((data || []).map((x) => x.user_id))));
  }, [sb, bump]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return Object.values(people)
      .filter((p) => (st === 'all' || p.status === st) && (!term || `${p.name} ${p.email} ${p.title}`.toLowerCase().includes(term)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [people, q, st]);
  const editing = sel ? people[sel] : null;

  return (
    <>
      <PageHead title="บัญชีผู้ใช้และลายเซ็น" lead="Accounts & signatures — roles, approval positions and each person's signature">
        <Link className="btn o" href="/admin/applications">คำขอเปิดบัญชี · Applications</Link>
      </PageHead>
      <div className="card">
        <div className="grid">
          <label className="f span2">ค้นหา · Search<input className="in" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ชื่อ อีเมล ตำแหน่ง · Name, email, title" /></label>
          <label className="f">สถานะ · Status
            <select className="in" value={st} onChange={(e) => setSt(e.target.value as typeof st)}>
              <option value="all">ทั้งหมด · All</option>
              {(Object.keys(STATUS_TH) as ProfileStatus[]).map((s) => <option key={s} value={s}>{STATUS_TH[s]} · {s}</option>)}
            </select>
          </label>
        </div>
        <span className="note">ผู้ใช้ใหม่เพิ่มเข้ามาเองเมื่อเข้าสู่ระบบด้วย Microsoft 365 ครั้งแรก · New people appear here after their first Microsoft 365 sign-in.</span>
      </div>
      <div className="row">
        <div className="grow">
          <div className="tw">
            <table className="t" style={{ minWidth: 640 }}>
              <thead><tr><th>ชื่อ · Name</th><th>บทบาท · Roles</th><th>ตำแหน่งอนุมัติ</th><th>ลายเซ็น</th><th>สถานะ</th></tr></thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} style={sel === u.id ? { background: 'var(--soft)' } : undefined}>
                    <td>
                      <button className="link-btn" style={{ textAlign: 'left', fontWeight: 500 }} onClick={() => setSel(u.id)}>{u.name || u.email}</button>
                      <div className="note">{u.title || '—'} · {deptTh(u.dept)}</div>
                    </td>
                    <td>{u.roles.map((r) => <span key={r} className="chip st-draft" style={{ marginRight: 4 }}>{ROLE_TH[r]}</span>)}</td>
                    <td>{u.position ? posTh(u.position) : '—'}</td>
                    <td>{sigIds.has(u.id) ? <span style={{ color: 'var(--sage-ink)' }}>✓ มี</span> : u.roles.includes('approver') ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>! ยังไม่มี</span> : '—'}</td>
                    <td>{STATUS_TH[u.status]}</td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={5} className="note">ไม่พบ · No match</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="side">
          {editing ? (
            <Editor p={editing} hasSig={sigIds.has(editing.id)} onSaved={async () => { await reloadRefs(); const { data } = await sb.from('signatures').select('user_id'); setSigIds(new Set((data || []).map((x) => x.user_id))); }} />
          ) : (
            <div className="card"><p className="lead" style={{ margin: 0 }}>เลือกชื่อในตารางเพื่อแก้ไข · Pick a person to edit</p></div>
          )}
        </div>
      </div>
    </>
  );
}

export default function Page() {
  return <AdminGate><Users /></AdminGate>;
}
