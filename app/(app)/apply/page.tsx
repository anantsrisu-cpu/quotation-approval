'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { PageHead } from '@/components/ui';
import { dt } from '@/lib/format';
import type { Role } from '@/lib/types';

export default function ApplyPage() {
  const { sb, me, departments, run, reloadMe, toast } = useApp();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [dept, setDept] = useState('');
  const [roles, setRoles] = useState<Role[]>(['preparer']);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!me) return;
    setName(me.name || '');
    setTitle(me.title || '');
    setDept(me.dept || departments[0]?.id || '');
    if (me.requested_roles?.length) setRoles(me.requested_roles);
    setNote(me.apply_note || '');
  }, [me, departments]);

  if (!me) return null;

  if (me.status === 'disabled') {
    return (
      <div className="card">
        <h1>บัญชีนี้ถูกปิดใช้งาน</h1>
        <p className="lead">This account has been disabled. Contact your admin if you need access again.</p>
      </div>
    );
  }

  const toggle = (r: Role) => setRoles((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]));
  const missing: string[] = [];
  if (!name.trim()) missing.push('กรอกชื่อ-นามสกุล · Enter your name');
  if (!dept) missing.push('เลือกฝ่าย · Choose your department');
  if (!roles.length) missing.push('เลือกบทบาทอย่างน้อย 1 บทบาท · Choose at least one role');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (missing.length) return;
    setBusy(true);
    const { ok } = await run('submit_application', sb.rpc('submit_application', {
      p_name: name.trim(), p_title: title.trim(), p_dept: dept, p_roles: roles, p_note: note.trim(),
    }));
    setBusy(false);
    if (ok) {
      toast('ok', 'ส่งใบสมัครแล้ว · Application sent', 'ผู้ดูแลระบบจะตรวจและเปิดใช้งานให้ · The admin will review it');
      setEditing(false);
      await reloadMe();
    }
  }

  const showForm = me.status === 'new' || me.status === 'rejected' || editing;

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* step indicator: sign in → apply → admin review → active */}
      <ol className="row" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }} aria-label="ขั้นตอนการเปิดบัญชี · Account steps">
        {[
          ['1', 'เข้าสู่ระบบ', 'Signed in', true],
          ['2', 'กรอกใบสมัคร', 'Apply', me.status !== 'new'],
          ['3', 'ผู้ดูแลตรวจ', 'Admin review', false],
          ['4', 'เปิดใช้งาน', 'Active', false],
        ].map(([n, th, en, done]) => (
          <li key={n as string} className="chip" style={{ background: done ? 'var(--sage)' : 'var(--line)', color: done ? 'var(--sage-ink)' : 'var(--ink-2)', padding: '6px 12px' }}>
            {done ? '✓' : n} {th} · {en}
          </li>
        ))}
      </ol>

      {me.status === 'pending' && !editing && (
        <div className="card" style={{ border: '2px solid var(--brown)' }}>
          <h1>ส่งใบสมัครแล้ว รอผู้ดูแลระบบตรวจ</h1>
          <p className="lead">Application sent {dt(me.applied_at)} — waiting for an admin to review. You will be notified here once your account is active.</p>
          <dl className="kv">
            <div><dt>ชื่อ · Name</dt><dd>{me.name}</dd></div>
            <div><dt>ตำแหน่งงาน · Job title</dt><dd>{me.title || '—'}</dd></div>
            <div><dt>ฝ่าย · Department</dt><dd>{departments.find((d) => d.id === me.dept)?.th || '—'}</dd></div>
            <div><dt>บทบาทที่ขอ · Requested roles</dt><dd>{me.requested_roles.map((r) => (r === 'preparer' ? 'ผู้จัดทำ' : 'ผู้อนุมัติ')).join(', ')}</dd></div>
          </dl>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn" onClick={() => reloadMe()}>ตรวจสถานะอีกครั้ง · Check again</button>
            <button className="btn o" onClick={() => setEditing(true)}>แก้ไขใบสมัคร · Edit application</button>
          </div>
        </div>
      )}

      {me.status === 'rejected' && (
        <div className="bad-box">
          <b>ใบสมัครครั้งก่อนไม่ผ่าน · Your previous application was not approved</b>
          {me.review_note && <div>เหตุผล · Reason: {me.review_note}</div>}
          <div style={{ fontSize: 13 }}>แก้ไขข้อมูลแล้วส่งใหม่ได้ · You can update it and apply again.</div>
        </div>
      )}

      {showForm && (
        <form className="card" onSubmit={submit} noValidate>
          <PageHead title="สมัครใช้งานระบบ" lead={`Apply for an account · ${me.email}`} />
          <div className="grid">
            <label className="f" htmlFor="a-name">ชื่อ-นามสกุล · Full name <span className="req">*</span>
              <input className="in" id="a-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
            <label className="f" htmlFor="a-title">ตำแหน่งงาน · Job title
              <input className="in" id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="f" htmlFor="a-dept">ฝ่าย · Department <span className="req">*</span>
              <select className="in" id="a-dept" value={dept} onChange={(e) => setDept(e.target.value)}>
                {departments.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.th} · {d.en}</option>)}
              </select>
            </label>
          </div>
          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend style={{ fontSize: 14, fontWeight: 500, padding: 0 }}>บทบาทที่ต้องการ · Role requested <span className="req">*</span></legend>
            <div className="grid" style={{ marginTop: 8 }}>
              {([
                ['preparer', 'ผู้จัดทำคำขอ · Requestor', 'สร้างคำขออนุมัติ แนบใบเสนอราคา ติดตามสถานะ · Create requests and track status'],
                ['approver', 'ผู้อนุมัติ · Approver', 'ตรวจและลงนามอนุมัติตามวงเงิน · Review and sign within price tiers'],
              ] as [Role, string, string][]).map(([r, label, desc]) => (
                <label key={r} className="check" style={{ border: `2px solid ${roles.includes(r) ? 'var(--brown)' : 'var(--beige)'}`, borderRadius: 10, padding: 12, background: '#fff' }}>
                  <input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} />
                  <span><b>{label}</b><span className="note" style={{ display: 'block' }}>{desc}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="f" htmlFor="a-note">หมายเหตุถึงผู้ดูแล · Note to admin
            <textarea className="in" id="a-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ผู้บังคับบัญชา หรือเหตุผลที่ต้องการใช้งาน · e.g. your manager, why you need access" />
          </label>
          {missing.length > 0 && (
            <div className="warn-box"><ul style={{ margin: 0, paddingLeft: 20 }}>{missing.map((m) => <li key={m}>{m}</li>)}</ul></div>
          )}
          <div className="actions">
            <span className="note">ผู้ดูแลจะกำหนดตำแหน่งอนุมัติและลายเซ็นให้ภายหลัง · The admin sets approval positions and signatures</span>
            <div className="row" style={{ gap: 10 }}>
              {editing && <button type="button" className="btn" onClick={() => setEditing(false)}>ยกเลิก · Cancel</button>}
              <button type="submit" className="btn p" disabled={busy || missing.length > 0}>{busy ? 'กำลังส่ง… · Sending…' : 'ส่งใบสมัคร · Submit application'}</button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
