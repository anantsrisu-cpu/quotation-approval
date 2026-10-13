'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { SignaturePad, imageToSignature, type PadHandle } from '@/components/SignaturePad';
import { PageHead } from '@/components/ui';
import { ROLE_TH } from '@/lib/format';

export default function ProfilePage() {
  const { sb, me, uid, deptTh, posTh, run, toast } = useApp();
  const [sig, setSig] = useState<string | null | undefined>(undefined);
  const [pending, setPending] = useState<string | null>(null);
  const pad = useRef<PadHandle>(null);

  useEffect(() => {
    if (!uid) return;
    sb.from('signatures').select('data').eq('user_id', uid).maybeSingle().then(({ data }) => setSig(data?.data || null));
  }, [sb, uid]);

  if (!me) return null;

  async function save() {
    const data = pending || pad.current?.getData();
    if (!data) return toast('bad', 'ยังไม่มีลายเซ็น · Nothing to save', 'วาดหรืออัปโหลดรูปลายเซ็นก่อน · Draw or upload a signature first');
    const { ok } = await run('save-own-signature', sb.from('signatures').upsert({ user_id: uid, data, updated_by: uid, updated_at: new Date().toISOString() }));
    if (ok) {
      setSig(data);
      setPending(null);
      pad.current?.clear();
      toast('ok', 'บันทึกลายเซ็นแล้ว · Signature saved', 'จะใช้ในหนังสืออนุมัติครั้งถัดไป · Used on your next approvals');
    }
  }

  return (
    <>
      <PageHead title="บัญชีและลายเซ็นของฉัน" lead="My account & signature" />
      <div className="row">
        <div className="card grow">
          <h2>ข้อมูลบัญชี · Account</h2>
          <dl className="kv">
            <div><dt>ชื่อ · Name</dt><dd>{me.name}</dd></div>
            <div><dt>อีเมล · Email</dt><dd>{me.email}</dd></div>
            <div><dt>ตำแหน่งงาน · Job title</dt><dd>{me.title || '—'}</dd></div>
            <div><dt>ฝ่าย · Department</dt><dd>{deptTh(me.dept)}</dd></div>
            <div><dt>บทบาท · Roles</dt><dd>{me.roles.map((r) => ROLE_TH[r]).join(', ') || '—'}</dd></div>
            <div><dt>ตำแหน่งอนุมัติ · Approver position</dt><dd>{me.position ? posTh(me.position) : '—'}</dd></div>
          </dl>
          <span className="note">ต้องการแก้ไขข้อมูลหรือบทบาท ติดต่อผู้ดูแลระบบ · Ask the admin to change your details or roles.</span>
        </div>
        <div className="card side" style={{ border: '2px solid var(--brown)' }}>
          <h2>ลายเซ็น · Signature</h2>
          {sig === undefined ? <div className="skeleton" /> : sig ? (
            <div className="sig-box"><img className="sig-img" src={sig} alt="ลายเซ็นปัจจุบัน · Current signature" /></div>
          ) : <div className="warn-box">ยังไม่มีลายเซ็น · No signature yet{me.roles.includes('approver') ? ' — ต้องมีก่อนอนุมัติ · required before you can approve' : ''}</div>}
          {pending ? (
            <div className="sig-box"><img className="sig-img" src={pending} alt="ลายเซ็นที่อัปโหลด · Uploaded signature" /></div>
          ) : <SignaturePad ref={pad} />}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => { pad.current?.clear(); setPending(null); }}>ล้าง · Clear</button>
            <label className="btn sm" style={{ cursor: 'pointer' }}>อัปโหลดรูป · Upload image
              <input type="file" accept="image/*" className="sr" onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try { setPending(await imageToSignature(f)); } catch (err: any) { toast('bad', err.message); }
              }} />
            </label>
          </div>
          <button className="btn p" onClick={save}>{sig ? 'บันทึกลายเซ็นใหม่ · Replace signature' : 'บันทึกลายเซ็น · Save signature'}</button>
          <span className="note">ลายเซ็นที่ลงในหนังสือแล้วจะไม่เปลี่ยนตาม · Letters already signed keep the signature used at the time.</span>
        </div>
      </div>
    </>
  );
}
