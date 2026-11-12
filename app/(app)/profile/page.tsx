'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { SignaturePad, imageToSignature, type PadHandle } from '@/components/SignaturePad';
import { PageHead } from '@/components/ui';
import { InstallApp } from '@/components/Pwa';
import { ROLE_TH } from '@/lib/format';

export default function ProfilePage() {
  const { sb, me, uid, deptTh, posTh, run, toast, settings, reloadMe } = useApp();
  const [mailOn, setMailOn] = useState(true);
  const [mailExtra, setMailExtra] = useState('');
  const [mailBusy, setMailBusy] = useState(false);
  useEffect(() => {
    if (!me) return;
    setMailOn(me.email_notify !== false);
    setMailExtra(me.notify_email || '');
  }, [me]);
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
      toast('ok', 'บันทึกลายเซ็นแล้ว · Signature saved', 'จะใช้ในตารางเปรียบเทียบราคาครั้งถัดไป · Used on your next approvals');
    }
  }

  const domain = (me.email.split('@')[1] || '').toLowerCase();
  const hasMail = 'email_notify' in me; // SQL 0018 has been run
  async function saveMail() {
    const extra = mailExtra.trim().toLowerCase();
    if (extra && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(extra)) return toast('bad', 'รูปแบบอีเมลไม่ถูกต้อง · Not a valid e-mail', '');
    if (extra && extra.split('@')[1] !== domain) return toast('bad', 'ใช้ได้เฉพาะอีเมลบริษัท · Company e-mail only', `ต้องลงท้ายด้วย @${domain} เหมือนอีเมลเข้าสู่ระบบ`);
    setMailBusy(true);
    const { ok } = await run('save-email-prefs', sb.rpc('set_my_email_prefs', { p_on: mailOn, p_email: extra }));
    setMailBusy(false);
    if (ok) {
      await reloadMe();
      toast('ok', 'บันทึกการแจ้งเตือนทางอีเมลแล้ว · E-mail settings saved', mailOn ? [me!.email, extra].filter(Boolean).join(', ') : 'ปิดการส่งอีเมล · Off');
    }
  }

  return (
    <>
      <PageHead title="บัญชีและลายเซ็นของฉัน" lead="My account & signature" />
      <div className="card" id="install" style={{ scrollMarginTop: 80 }}>
        <h2>ติดตั้งแอปบนมือถือ · Install on your phone</h2>
        <InstallApp />
      </div>
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
          {hasMail && (
            <form className="mail-prefs" id="mail-prefs" noValidate autoComplete="off" onSubmit={(e) => { e.preventDefault(); saveMail(); }}>
              <h2>การแจ้งเตือนทางอีเมล · E-mail notifications</h2>
              {settings?.email_enabled === false && <div className="warn-box">ผู้ดูแลระบบยังไม่ได้เปิดการส่งอีเมล — ตั้งค่าไว้ก่อนได้ จะเริ่มส่งเมื่อเปิดใช้ · Not switched on yet by the admin.</div>}
              <label className="check"><input type="checkbox" id="mail-on" checked={mailOn} onChange={(e) => setMailOn(e.target.checked)} />ส่งการแจ้งเตือนเข้าอีเมลของฉัน · Send my notifications by e-mail</label>
              <dl className="kv"><div><dt>ส่งถึง · Sent to</dt><dd>{me.email} <span className="note">(อีเมลเข้าสู่ระบบ เปลี่ยนไม่ได้)</span></dd></div></dl>
              <label className="f" htmlFor="mail-extra">อีเมลเพิ่มเติม (ไม่บังคับ) · One more address
                <input className="in" id="mail-extra" type="email" inputMode="email" autoComplete="off" disabled={!mailOn} value={mailExtra} maxLength={200}
                  placeholder={`เช่น team@${domain}`} onChange={(e) => setMailExtra(e.target.value)} />
                <span className="note" style={{ fontWeight: 400 }}>ต้องเป็นอีเมลบริษัทโดเมนเดียวกับอีเมลเข้าสู่ระบบ (@{domain}) · Same domain as your sign-in e-mail</span>
              </label>
              <button className="btn p" type="submit" id="mail-save" disabled={mailBusy} style={{ justifySelf: 'start' }}>{mailBusy ? 'กำลังบันทึก…' : 'บันทึกการแจ้งเตือน · Save'}</button>
            </form>
          )}
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
