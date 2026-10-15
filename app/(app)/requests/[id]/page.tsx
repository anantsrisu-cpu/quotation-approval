'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { CoverLetter } from '@/components/CoverLetter';
import { SignaturePad, type PadHandle } from '@/components/SignaturePad';
import { Chain, Chip, Loading, Modal } from '@/components/ui';
import { PURP, SUBJ, dt, fileSize, fmt } from '@/lib/format';
import { itemsOf } from '@/lib/calc';
import { CompareTable, ItemsTable } from '@/components/ItemTables';
import { downloadUrl, elementToPdf } from '@/lib/pdf';
import { reportError } from '@/lib/errors';
import type { LogEntry, RequestFile, RequestRow, RequestStep } from '@/lib/types';

type Cand = { id: string; name: string; pos: string; pos_th: string };

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const app = useApp();
  const { sb, uid, bump, name, deptTh, company, posTh, run, toast, has } = app;
  const router = useRouter();

  const [r, setR] = useState<RequestRow | null | undefined>(undefined);
  const [steps, setSteps] = useState<RequestStep[]>([]);
  const [files, setFiles] = useState<RequestFile[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [mySig, setMySig] = useState<string | null | undefined>(undefined);
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'forward' | 'cancel'>(null);
  const [cands, setCands] = useState<Cand[]>([]);
  const [fwdTo, setFwdTo] = useState('');
  const [reason, setReason] = useState('');
  const [pdfState, setPdfState] = useState<'idle' | 'making' | 'failed'>('idle');
  const letterRef = useRef<HTMLElement>(null);
  const padRef = useRef<PadHandle>(null);
  const autoTried = useRef(false);

  const load = useCallback(async () => {
    const [a, b, c, d] = await Promise.all([
      sb.from('requests').select('*').eq('id', id).maybeSingle(),
      sb.from('request_steps').select('*').eq('request_id', id).order('step_no'),
      sb.from('request_files').select('*').eq('request_id', id).order('id'),
      sb.from('request_log').select('*').eq('request_id', id).order('at', { ascending: false }),
    ]);
    setR((a.data as RequestRow) || null);
    setSteps((b.data as RequestStep[]) || []);
    setFiles((c.data as RequestFile[]) || []);
    setLog((d.data as LogEntry[]) || []);
  }, [sb, id]);

  useEffect(() => { load(); }, [load, bump]);

  useEffect(() => {
    if (!uid) return;
    sb.from('signatures').select('data').eq('user_id', uid).maybeSingle().then(({ data }) => setMySig(data?.data || null));
  }, [sb, uid]);

  const cur = r ? steps.find((s) => s.step_no === r.current_step) : undefined;
  const mine = !!r && r.status === 'pending' && cur?.approver_id === uid;
  const isLast = !!cur && cur.step_no === Math.max(...steps.map((s) => s.step_no));
  const isPrep = r?.preparer_id === uid || (!!r?.created_by && r.created_by === uid && has('admin'));
  const proxy = !!r?.created_by && r.created_by !== r.preparer_id;
  const involved = !!r && (isPrep || r.buyer_id === uid || steps.some((s) => [s.approver_id, s.signer_id, s.on_behalf_of].includes(uid)) || has('admin'));

  /** Build the PDF from the on-screen letter and store it (runs once after final approval). */
  const makePdf = useCallback(async () => {
    if (!r || !letterRef.current || r.status !== 'approved') return;
    setPdfState('making');
    try {
      const blob = await elementToPdf(letterRef.current);
      const path = `${r.id}/${(r.no || 'letter').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
      const up = await sb.storage.from('letters').upload(path, blob, { contentType: 'application/pdf', upsert: has('admin') });
      if (up.error && !/exists|Duplicate/i.test(up.error.message)) throw up.error;
      const { error } = await sb.rpc('set_letter', { p_id: r.id, p_path: path });
      if (error) throw error;
      setPdfState('idle');
      await load();
    } catch (e: any) {
      setPdfState('failed');
      reportError(e?.message || String(e), { action: 'make-letter-pdf', detail: e?.stack || '' });
    }
  }, [r, sb, load, has]);

  // After the final approval, the first involved person to open the request creates the PDF once.
  useEffect(() => {
    if (!r || r.status !== 'approved' || r.letter_path || !involved || autoTried.current) return;
    const t = setTimeout(() => {
      if (autoTried.current || !letterRef.current) return;
      autoTried.current = true;
      makePdf();
    }, 800); // let fonts and signature images settle; re-armed if the page re-renders
    return () => clearTimeout(t);
  }, [r, involved, makePdf]);

  if (r === undefined) return <Loading rows={5} />;
  if (r === null)
    return (
      <div className="card">
        <h1>ไม่พบคำขอ หรือคุณไม่มีสิทธิ์ดู</h1>
        <p className="lead">Request not found, or you do not have access to it.</p>
        <Link className="btn" href="/">← หน้าหลัก · Home</Link>
      </div>
    );

  async function downloadPdf() {
    if (!r?.letter_path) return;
    const { data, error } = await sb.storage.from('letters').createSignedUrl(r.letter_path, 120, { download: `${r.no || 'letter'}.pdf` });
    if (error || !data) return toast('bad', 'ดาวน์โหลดไม่สำเร็จ · Download failed', error?.message);
    downloadUrl(data.signedUrl, `${r.no || 'letter'}.pdf`);
  }
  async function openFile(f: RequestFile) {
    const { data, error } = await sb.storage.from('attachments').createSignedUrl(f.path, 300);
    if (error || !data) return toast('bad', 'เปิดไฟล์ไม่ได้ · Cannot open file', error?.message);
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function approve() {
    if (!confirm) return toast('bad', 'ยังอนุมัติไม่ได้ · Not approved yet', 'ติ๊กยืนยันการลงนามก่อน · Tick the confirmation box first');
    setBusy('approve');
    if (!mySig) {
      const drawn = padRef.current?.getData();
      if (!drawn) {
        setBusy(null);
        return toast('bad', 'ยังไม่มีลายเซ็น · No signature', 'วาดลายเซ็นในกรอบก่อน · Draw your signature first');
      }
      const s = await run('save-own-signature', sb.from('signatures').upsert({ user_id: uid, data: drawn, updated_by: uid, updated_at: new Date().toISOString() }));
      if (!s.ok) return setBusy(null);
      setMySig(drawn);
    }
    const { ok, data } = await run<{ done: boolean; next?: string; step?: number }>('approve_request', sb.rpc('approve_request', { p_id: id, p_comment: comment }));
    setBusy(null);
    if (ok && data) {
      toast('ok', 'อนุมัติและลงนามสำเร็จ · Approved & signed', data.done ? 'อนุมัติครบ กำลังสร้างหนังสืออนุมัติ PDF · Fully approved, creating the PDF letter' : `ส่งต่อถึง ${data.next} (ขั้นที่ ${data.step})`);
      setComment('');
      setConfirm(false);
      app.refresh();
      await load();
    }
  }
  async function reject() {
    if (!comment.trim()) return toast('bad', 'ต้องระบุความเห็น · Comment required', 'บอกเหตุผลที่ไม่อนุมัติให้ผู้จัดทำทราบ · Tell the preparer why');
    setBusy('reject');
    const { ok } = await run('reject_request', sb.rpc('reject_request', { p_id: id, p_comment: comment.trim() }));
    setBusy(null);
    if (ok) {
      toast('ok', 'บันทึกการไม่อนุมัติแล้ว · Rejection saved', 'ส่งกลับให้ผู้จัดทำพร้อมเหตุผล · Returned to the preparer');
      app.refresh();
      router.push('/inbox');
    }
  }
  async function openForward() {
    const { data } = await sb.rpc('forward_candidates', { p_id: id });
    setCands((data as Cand[]) || []);
    setFwdTo(((data as Cand[]) || [])[0]?.id || '');
    setReason('');
    setModal('forward');
  }
  async function doForward() {
    if (!fwdTo || !reason.trim()) return toast('bad', 'ข้อมูลไม่ครบ · Missing info', 'เลือกบัญชีและระบุเหตุผล · Choose an account and give a reason');
    setBusy('forward');
    const { ok } = await run('forward_request', sb.rpc('forward_request', { p_id: id, p_to: fwdTo, p_reason: reason.trim() }));
    setBusy(null);
    if (ok) {
      toast('ok', 'ส่งให้อนุมัติแทนแล้ว · Forwarded', `${name(fwdTo)} ได้รับแจ้งแล้ว · has been notified`);
      setModal(null);
      app.refresh();
      router.push('/inbox');
    }
  }
  async function doCancel() {
    if (!reason.trim()) return toast('bad', 'ต้องระบุเหตุผล · Reason required', '');
    setBusy('cancel');
    const { ok } = await run('cancel_request', sb.rpc('cancel_request', { p_id: id, p_reason: reason.trim() }));
    setBusy(null);
    if (ok) {
      toast('ok', 'ยกเลิกคำขอแล้ว · Request cancelled', '');
      setModal(null);
      await load();
    }
  }
  async function reopen() {
    setBusy('reopen');
    const { ok } = await run('reopen_request', sb.rpc('reopen_request', { p_id: id }));
    setBusy(null);
    if (ok) router.push(`/requests/new?id=${id}`);
  }

  const co = company(r.company_id);
  const rejectedStep = steps.find((s) => s.status === 'rejected');
  const kindClass = (k: string) => (['rejected', 'cancelled'].includes(k) ? 'bad' : ['sent', 'approved', 'completed', 'pdf'].includes(k) ? 'ok' : 'wait');
  const chainRow = { ...r, request_steps: steps };

  return (
    <>
      <div className="head">
        <div style={{ minWidth: 0 }}>
          <button className="btn sm" onClick={() => router.back()} style={{ marginBottom: 6 }}>← กลับ · Back</button>
          <h1>{r.product_name || r.sku || 'คำขอ'} <Chip status={r.status} /></h1>
          <p className="lead"><span className="mono">{r.no || 'ยังไม่ออกเลข'}</span> · {SUBJ[r.subject_type]} · {deptTh(r.dept)} · {dt(r.submitted_at || r.created_at)}</p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {isPrep && r.status === 'draft' && <Link className="btn o" href={`/requests/new?id=${r.id}`}>แก้ไขฉบับร่าง · Edit draft</Link>}
          {isPrep && r.status === 'rejected' && <button className="btn o" disabled={!!busy} onClick={reopen}>แก้ไขและส่งใหม่ · Edit &amp; resend</button>}
          {isPrep && (has('preparer') || has('admin')) && <Link className="btn" href={`/requests/new?copy=${r.id}`}>ใช้เป็นแบบคำขอใหม่ · Copy to new</Link>}
          {(isPrep || has('admin')) && (r.status === 'pending' || r.status === 'draft') && (
            <button className="btn d" onClick={() => { setReason(''); setModal('cancel'); }}>ยกเลิกคำขอ · Cancel</button>
          )}
          {r.status === 'approved' && r.letter_path && <button className="btn p" onClick={downloadPdf}>ดาวน์โหลดหนังสืออนุมัติ PDF · Download PDF</button>}
        </div>
      </div>

      {r.status === 'approved' && (
        r.letter_path ? (
          <div className="ok-box">✓ อนุมัติครบทุกขั้นแล้ว หนังสืออนุมัติบันทึกเป็น PDF เรียบร้อย กระบวนการเสร็จสิ้น · Fully approved; the letter is saved as PDF and the request is complete.</div>
        ) : pdfState === 'failed' ? (
          <div className="bad-box">สร้าง PDF ไม่สำเร็จ ระบบแจ้งผู้ดูแลแล้ว · Could not create the PDF (admin notified). <button className="btn sm" onClick={makePdf}>ลองอีกครั้ง · Try again</button></div>
        ) : (
          <div className="warn-box">{pdfState === 'making' ? 'กำลังสร้างหนังสืออนุมัติ PDF… · Creating the PDF letter…' : 'อนุมัติครบแล้ว รอสร้าง PDF · Approved; PDF not created yet'} {involved && pdfState !== 'making' && <button className="btn sm" onClick={makePdf}>สร้าง PDF · Create PDF</button>}</div>
        )
      )}
      {r.status === 'rejected' && <div className="bad-box">ไม่อนุมัติ โดย {name(rejectedStep?.signer_id)} · Rejected — “{rejectedStep?.comment}”</div>}
      {r.status === 'cancelled' && <div className="warn-box">คำขอนี้ถูกยกเลิก · This request was cancelled</div>}
      {mine && <div className="warn-box"><b>คำขอนี้รอคุณอนุมัติ</b> · Waiting for your decision — ขั้นที่ {r.current_step + 1} จาก {steps.length}{cur?.on_behalf_of ? ` · อนุมัติแทน ${name(cur.on_behalf_of)}` : ''}</div>}

      <div className="row">
        <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <h2>รายละเอียด · Details</h2>
            <dl className="kv">
              {[
                ['เรื่อง · Subject', SUBJ[r.subject_type]],
                ['จำนวนรายการ · Items', `${itemsOf(r).length} รายการ`],
                ['ฝ่ายที่ขอซื้อ · Department', deptTh(r.dept)],
                ['ซื้อเพื่อ · Purpose', PURP[r.purpose]],
                ['ผู้ขาย · Vendor', r.vendor],
                ['เลขที่ใบเสนอราคา · Quote no.', r.quote_no || '—'],
                ['ผู้ซื้อ · Buyer', name(r.buyer_id)],
                ['บริษัทผู้ซื้อ · Buyer company', co?.th || '—'],
                ['ผู้จัดทำ · Prepared by', name(r.preparer_id) + (proxy ? ` (จัดทำแทนโดย ${name(r.created_by)})` : '')],
                ['ระดับวงเงิน · Tier', r.tier_label || '—'],
              ].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}
            </dl>
            <div className="tiles">
              <div className="tile"><span>จำนวนรายการ · Items</span><b style={{ fontSize: 20 }} className="num">{itemsOf(r).length}</b></div>
              <div className="tile"><span>มูลค่ารวม ก่อน VAT</span><b style={{ fontSize: 20 }} className="num">{fmt(r.subtotal)}</b></div>
              <div className="tile"><span>VAT</span><b style={{ fontSize: 20 }} className="num">{fmt(r.vat)}</b></div>
              <div className="tile"><span>ยอดรวมสุทธิ (บาท)</span><b className="num">{fmt(r.total)}</b></div>
            </div>
            {r.details && <div><span className="note">รายละเอียด · Details</span><div style={{ whiteSpace: 'pre-wrap' }}>{r.details}</div></div>}
            {r.message && <div className="box" style={{ borderStyle: 'solid' }}>ข้อความจากผู้จัดทำ · Note: {r.message}</div>}
          </div>

          <div className="card">
            <h2>รายการสินค้า · Items ({itemsOf(r).length})</h2>
            <ItemsTable r={r} />
          </div>

          <div className="card">
            <h2>คู่เทียบราคา · Price comparison</h2>
            {r.no_comp ? (
              <div className="warn-box">ไม่มีคู่เทียบ · เหตุผล: {r.no_comp_reason}</div>
            ) : (
              <CompareTable r={r} />
            )}
            {r.low_reason && <div className="warn-box">ไม่ใช่ราคาต่ำสุด เหตุผล: {r.low_reason}</div>}
            <div>
              <span className="note">ไฟล์แนบ · Attachments (กดเพื่อเปิดดู · click to open)</span>
              {files.length ? (
                <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {files.map((f) => (
                    <li key={f.id} className="file-row">
                      <span className="chip st-draft">{(f.name.split('.').pop() || '').toUpperCase()}</span>
                      <button className="link-btn nm" style={{ textAlign: 'left' }} onClick={() => openFile(f)}>{f.name}</button>
                      <span className="note">{fileSize(f.size)}</span>
                    </li>
                  ))}
                </ul>
              ) : <div>—</div>}
            </div>
          </div>
        </div>

        <div className="side" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {mine && (
            <div className="card" style={{ border: '2px solid var(--brown)' }}>
              <h2>การตัดสินใจของคุณ · Your decision</h2>
              <label className="f" htmlFor="rv-comment">ความเห็น · Comment <span className="note" style={{ fontWeight: 400 }}>(บังคับเมื่อไม่อนุมัติ · required to reject)</span>
                <textarea className="in" id="rv-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
              <div className="f" style={{ fontSize: 14, fontWeight: 500 }}>ลายเซ็นที่จะใช้ · Signature to apply
                {mySig === undefined ? <div className="skeleton" /> : mySig ? (
                  <>
                    <div className="sig-box"><img className="sig-img" src={mySig} alt="ลายเซ็นของคุณ · Your signature" /></div>
                    <span className="note" style={{ fontWeight: 400 }}>ลายเซ็นที่บันทึกในบัญชีของคุณ · Saved in your account (<Link href="/profile">เปลี่ยน · change</Link>)</span>
                  </>
                ) : (
                  <>
                    <SignaturePad ref={padRef} />
                    <div className="row" style={{ gap: 8 }}>
                      <button type="button" className="btn sm" onClick={() => padRef.current?.clear()}>ล้าง · Clear</button>
                      <span className="note" style={{ fontWeight: 400 }}>ยังไม่มีลายเซ็นในบัญชี วาดที่นี่ ระบบจะบันทึกให้ · No saved signature; draw it here and it will be saved</span>
                    </div>
                  </>
                )}
              </div>
              <label className="check" htmlFor="rv-confirm">
                <input type="checkbox" id="rv-confirm" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                ข้าพเจ้ายืนยันการอนุมัติและยินยอมให้ใช้ลายเซ็นในหนังสืออนุมัติ · I confirm and allow my signature on the letter
              </label>
              <div className="row" style={{ gap: 10 }}>
                <button className="btn d" style={{ flex: '1 1 120px' }} disabled={!!busy} onClick={reject}>{busy === 'reject' ? '…' : 'ไม่อนุมัติ · Reject'}</button>
                <button className="btn p" style={{ flex: '2 1 170px' }} disabled={!!busy} onClick={approve}>{busy === 'approve' ? 'กำลังบันทึก… · Saving…' : '✓ อนุมัติและลงนาม · Approve & sign'}</button>
              </div>
              {isLast && (
                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button className="btn o" onClick={openForward}>ส่งให้ผู้อื่นอนุมัติแทน · Forward to another approver</button>
                  <span className="note" style={{ textAlign: 'center' }}>ผู้อนุมัติลำดับสุดท้าย เมื่อติดภารกิจ · Final approver only, when unavailable</span>
                </div>
              )}
            </div>
          )}

          <div className="card">
            <h2>ประวัติคำขอ · Request history</h2>
            <Chain r={chainRow} />
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
              {steps.map((s) => (
                <li key={s.step_no}>
                  {name(s.signer_id || s.approver_id)} — {posTh(s.position)}{' '}
                  <span className="note">({s.status === 'approved' ? 'อนุมัติ ' + dt(s.acted_at) : s.status === 'rejected' ? 'ไม่อนุมัติ' : s.status === 'pending' ? 'รอ' : s.status === 'cancelled' ? 'ยกเลิก' : 'ยังไม่ถึง'})</span>
                  {s.on_behalf_of && <span className="note"> · แทน {name(s.on_behalf_of)}</span>}
                </li>
              ))}
            </ol>
            <ol className="tl">
              {log.map((l) => (
                <li key={l.id}>
                  <span className={`m ${kindClass(l.kind)}`} />
                  <span>
                    <b style={{ fontWeight: 600 }}>{l.text}</b>
                    <div className="note">{name(l.actor_id)} · {dt(l.at)}</div>
                    {l.comment && <div style={{ background: 'var(--soft)', borderRadius: 8, padding: '6px 10px', marginTop: 4, fontSize: 14 }}>“{l.comment}”</div>}
                  </span>
                </li>
              ))}
              {!log.length && <li className="note">ยังไม่มีประวัติ · No history yet</li>}
            </ol>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="actions">
          <h2>หนังสืออนุมัติใบเสนอราคา · Approval letter</h2>
          {r.status === 'approved' && r.letter_path && <button className="btn p sm" onClick={downloadPdf}>ดาวน์โหลด PDF · Download PDF</button>}
        </div>
        <span className="note">
          {r.status === 'approved' ? 'อนุมัติครบแล้ว เอกสารล็อก แก้ไขไม่ได้ บันทึกเป็น PDF เท่านั้น · Locked; saved as PDF only' : 'ยังไม่อนุมัติครบ แสดงเป็นร่าง · Not fully approved — shown as draft'}
        </span>
        <div className="letter-wrap">
          <CoverLetter ref={letterRef} r={r} steps={steps} draft={r.status !== 'approved'} />
        </div>
      </div>

      {modal === 'forward' && (
        <Modal title="ส่งให้ผู้อื่นอนุมัติแทน · Forward" onClose={() => setModal(null)}>
          <label className="f" htmlFor="m-to">บัญชีผู้อนุมัติแทน · Account <span className="req">*</span>
            <select className="in" id="m-to" value={fwdTo} onChange={(e) => setFwdTo(e.target.value)}>
              {cands.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.pos_th}</option>)}
            </select>
            <span className="note" style={{ fontWeight: 400 }}>แสดงเฉพาะผู้อนุมัติที่มีลายเซ็น · Only approvers with a signature</span>
          </label>
          <label className="f" htmlFor="m-why">เหตุผล · Reason <span className="req">*</span>
            <textarea className="in" id="m-why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ติดประชุมต่างประเทศ · e.g. travelling" />
          </label>
          {!cands.length && <div className="warn-box">ไม่มีผู้อนุมัติที่เลือกได้ · No eligible approver</div>}
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setModal(null)}>ยกเลิก · Cancel</button>
            <button className="btn p" disabled={!cands.length || busy === 'forward'} onClick={doForward}>ยืนยัน · Confirm</button>
          </div>
        </Modal>
      )}
      {modal === 'cancel' && (
        <Modal title="ยกเลิกคำขอ · Cancel request" onClose={() => setModal(null)}>
          <label className="f" htmlFor="m-why2">เหตุผล · Reason <span className="req">*</span>
            <textarea className="in" id="m-why2" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setModal(null)}>ไม่ยกเลิก · Keep</button>
            <button className="btn d" disabled={busy === 'cancel'} onClick={doCancel}>ยกเลิกคำขอ · Cancel request</button>
          </div>
        </Modal>
      )}
    </>
  );
}
