'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { AdminGate } from '@/components/AdminGate';
import { SignaturePad, imageToSignature, type PadHandle } from '@/components/SignaturePad';
import { PageHead } from '@/components/ui';
import { ROLE_TH } from '@/lib/format';
import type { Profile, ProfileStatus, Role, UserInvite } from '@/lib/types';

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
        {p.status === 'active' && p.roles.includes('preparer') && <Link className="btn" href={`/requests/new?for=${p.id}`}>ร่างคำขอแทน · Draft for</Link>}
        <button type="button" className="btn p" style={{ flex: 1 }} disabled={busy} onClick={save}>{busy ? 'กำลังบันทึก…' : 'บันทึก · Save'}</button>
      </div>
    </form>
  );
}

type InviteDraft = { email: string; name: string; title: string; dept: string; roles: Role[]; position: string; signature: string | null };
const blankInvite: InviteDraft = { email: '', name: '', title: '', dept: '', roles: ['preparer'], position: '', signature: null };

/** Admin sets up an account by e-mail before the person has ever signed in. */
function InviteEditor({ init, onDone }: { init: InviteDraft | null; onDone: () => void }) {
  const { sb, departments, positions, run, toast } = useApp();
  const [e, setE] = useState<InviteDraft>(init || blankInvite);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pad = useRef<PadHandle>(null);
  const editing = !!init;

  useEffect(() => {
    setE(init || blankInvite);
    setPending(null);
  }, [init]);

  const toggle = (r: Role) => setE((x) => ({ ...x, roles: x.roles.includes(r) ? x.roles.filter((y) => y !== r) : [...x.roles, r] }));

  async function save() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.email.trim())) return toast('bad', 'อีเมลไม่ถูกต้อง · Invalid e-mail', 'ใช้อีเมล Microsoft 365 ของบริษัท · Use the company Microsoft 365 e-mail');
    if (!e.name.trim()) return toast('bad', 'กรอกชื่อ · Name required', '');
    if (!e.roles.length) return toast('bad', 'เลือกบทบาทอย่างน้อย 1 บทบาท · Choose a role', '');
    if (e.roles.includes('approver') && !e.position) return toast('bad', 'ผู้อนุมัติต้องมีตำแหน่งอนุมัติ · Approvers need a position', '');
    setBusy(true);
    const sig = pending || pad.current?.getData() || null;
    const { ok, data } = await run<string>('admin-create-account', sb.rpc('admin_create_account', {
      p_email: e.email.trim(), p_name: e.name.trim(), p_title: e.title.trim(), p_dept: e.dept || null,
      p_roles: e.roles, p_position: e.roles.includes('approver') ? e.position : null, p_signature: sig,
    }));
    setBusy(false);
    if (!ok) return;
    toast('ok', data === 'updated' ? 'ตั้งค่าบัญชีและเปิดใช้งานแล้ว · Account set up and activated' : 'สร้างบัญชีล่วงหน้าแล้ว · Account pre-created',
      data === 'updated' ? `${e.name} เคยเข้าสู่ระบบแล้ว ใช้งานได้ทันที · can use the app now` : `${e.email.trim().toLowerCase()} ใช้งานได้ทันทีเมื่อเข้าสู่ระบบด้วย Microsoft 365 ครั้งแรก · active at first sign-in`);
    if (!editing) setE(blankInvite);
    setPending(null);
    pad.current?.clear();
    onDone();
  }

  return (
    <form className="card" style={{ border: '2px solid var(--brown)' }} noValidate onSubmit={(ev) => ev.preventDefault()}>
      <h2>{editing ? `แก้ไขบัญชีล่วงหน้า: ${init?.email}` : 'สร้างบัญชีล่วงหน้า · Pre-create an account'}</h2>
      <span className="note">สร้างให้ผู้จัดทำหรือผู้อนุมัติได้เลยโดยไม่ต้องรอสมัคร เมื่อเขาเข้าสู่ระบบด้วย Microsoft 365 ครั้งแรก บัญชีจะใช้งานได้ทันทีพร้อมบทบาทและลายเซ็นนี้ · The person can use the app straight away at their first Microsoft 365 sign-in.</span>
      <label className="f" htmlFor="i-email">อีเมล Microsoft 365 · E-mail <span className="req">*</span>
        <input className="in" id="i-email" type="email" autoComplete="off" value={e.email} disabled={editing} onChange={(x) => setE({ ...e, email: x.target.value })} placeholder="name@company.co.th" />
      </label>
      <label className="f" htmlFor="i-name">ชื่อ-นามสกุล · Name <span className="req">*</span>
        <input className="in" id="i-name" value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} />
      </label>
      <label className="f" htmlFor="i-title">ตำแหน่งงาน · Job title
        <input className="in" id="i-title" value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} />
      </label>
      <label className="f" htmlFor="i-dept">ฝ่าย · Department
        <select className="in" id="i-dept" value={e.dept} onChange={(x) => setE({ ...e, dept: x.target.value })}>
          <option value="">—</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.th}</option>)}
        </select>
      </label>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend style={{ fontSize: 14, fontWeight: 500, padding: 0 }}>บทบาท · Roles <span className="req">*</span></legend>
        {(['preparer', 'approver', 'admin'] as Role[]).map((r) => (
          <label key={r} className="check"><input type="checkbox" checked={e.roles.includes(r)} onChange={() => toggle(r)} />{ROLE_TH[r]}</label>
        ))}
      </fieldset>
      <label className="f" htmlFor="i-pos">ตำแหน่งผู้อนุมัติ · Approver position
        <select className="in" id="i-pos" value={e.position} disabled={!e.roles.includes('approver')} onChange={(x) => setE({ ...e, position: x.target.value })}>
          <option value="">— ไม่ใช่ผู้อนุมัติ —</option>
          {positions.map((x) => <option key={x.code} value={x.code}>{x.th} · {x.en}</option>)}
        </select>
      </label>
      <div className="f" style={{ fontSize: 14, fontWeight: 500 }}>ลายเซ็น · Signature {e.roles.includes('approver') && <span className="note">(ผู้อนุมัติต้องมีลายเซ็นก่อนอนุมัติ)</span>}
        {e.signature && !pending && <div className="sig-box"><img className="sig-img" src={e.signature} alt="ลายเซ็นที่บันทึกไว้" /></div>}
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
        </div>
      </div>
      <button type="button" className="btn p" disabled={busy} onClick={save}>{busy ? 'กำลังบันทึก…' : editing ? 'บันทึก · Save' : 'สร้างบัญชี · Create account'}</button>
    </form>
  );
}

function Users() {
  const { sb, people, reloadRefs, bump, deptTh, posTh, run, toast } = useApp();
  const [sel, setSel] = useState<string | null>(null);
  const [invites, setInvites] = useState<UserInvite[]>([]);
  const [inv, setInv] = useState<InviteDraft | null | 'new'>(null);
  const loadInvites = async () => {
    const { data } = await sb.from('user_invites').select('*').is('used_at', null).order('created_at', { ascending: false });
    setInvites((data as UserInvite[]) || []);
  };
  useEffect(() => { loadInvites(); }, [sb, bump]); // eslint-disable-line react-hooks/exhaustive-deps
  async function removeInvite(email: string) {
    const { ok } = await run('admin-delete-invite', sb.from('user_invites').delete().eq('email', email));
    if (ok) {
      toast('ok', 'ลบบัญชีล่วงหน้าแล้ว · Pre-created account removed', email);
      if (inv && inv !== 'new' && inv.email === email) setInv(null);
      loadInvites();
    }
  }
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
        <button className="btn p" onClick={() => { setSel(null); setInv('new'); }}>+ สร้างบัญชีล่วงหน้า · Pre-create account</button>
      </PageHead>
      {invites.length > 0 && (
        <div className="card">
          <h2>บัญชีที่สร้างล่วงหน้า รอเข้าสู่ระบบครั้งแรก · Pre-created, waiting for first sign-in ({invites.length})</h2>
          <div className="tw">
            <table className="t" style={{ minWidth: 640 }}>
              <thead><tr><th>อีเมล · E-mail</th><th>ชื่อ · Name</th><th>บทบาท · Roles</th><th>ตำแหน่งอนุมัติ</th><th>ลายเซ็น</th><th><span className="sr">Actions</span></th></tr></thead>
              <tbody>
                {invites.map((x) => (
                  <tr key={x.email}>
                    <td className="mono" style={{ fontSize: 13 }}>{x.email}</td>
                    <td>{x.name}<div className="note">{x.title || '—'} · {deptTh(x.dept)}</div></td>
                    <td>{x.roles.map((r) => <span key={r} className="chip st-draft" style={{ marginRight: 4 }}>{ROLE_TH[r]}</span>)}</td>
                    <td>{x.position ? posTh(x.position) : '—'}</td>
                    <td>{x.signature ? <span style={{ color: 'var(--sage-ink)' }}>✓ มี</span> : x.roles.includes('approver') ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>! ยังไม่มี</span> : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn sm" onClick={() => { setSel(null); setInv({ email: x.email, name: x.name, title: x.title, dept: x.dept || '', roles: x.roles, position: x.position || '', signature: x.signature }); }}>แก้ไข · Edit</button>{' '}
                      <button className="btn sm d" onClick={() => removeInvite(x.email)}>ลบ · Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="note">ผู้อนุมัติที่ยังไม่เคยเข้าสู่ระบบจะยังไม่ถูกเลือกเป็นผู้อนุมัติในคำขอ จนกว่าจะเข้าสู่ระบบครั้งแรก · Approvers become selectable after their first sign-in.</span>
        </div>
      )}
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
        <span className="note">ผู้ใช้ใหม่เพิ่มเข้ามาเองเมื่อเข้าสู่ระบบด้วย Microsoft 365 ครั้งแรก หรือกด &quot;สร้างบัญชีล่วงหน้า&quot; เพื่อตั้งบทบาทและลายเซ็นไว้ก่อน · New people appear after their first Microsoft 365 sign-in, or pre-create their account.</span>
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
                      <button className="link-btn" style={{ textAlign: 'left', fontWeight: 500 }} onClick={() => { setInv(null); setSel(u.id); }}>{u.name || u.email}</button>
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
          {inv ? (
            <InviteEditor init={inv === 'new' ? null : inv} onDone={async () => { await loadInvites(); await reloadRefs(); if (inv !== 'new') setInv(null); }} />
          ) : editing ? (
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
