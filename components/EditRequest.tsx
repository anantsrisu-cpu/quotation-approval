'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp } from './AppProvider';
import { Modal } from './ui';
import type { RequestRow } from '@/lib/types';

/**
 * Edit a request in place (keeps its number and history), whatever stage it is at:
 * draft → open the form · rejected → back to draft, then the form ·
 * waiting for approval → recall it (asks first), then the form.
 */
export function EditRequestButton({ r, sm }: { r: Pick<RequestRow, 'id' | 'no' | 'status'>; sm?: boolean }) {
  const { sb, run, toast } = useApp();
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const cls = `btn o${sm ? ' sm' : ''}`;
  const form = `/requests/new?id=${r.id}`;

  if (r.status === 'draft') return <Link className={cls} href={form} id={`edit-${r.id}`}>แก้ไข · Edit</Link>;

  async function reopen() {
    setBusy(true);
    const { ok } = await run('reopen_request', sb.rpc('reopen_request', { p_id: r.id }));
    setBusy(false);
    if (ok) router.push(form);
  }
  async function recall() {
    setBusy(true);
    const { ok } = await run('recall_request', sb.rpc('recall_request', { p_id: r.id, p_reason: why.trim() }));
    setBusy(false);
    if (ok) {
      toast('ok', 'ดึงคำขอกลับมาแก้ไขแล้ว · Recalled', 'แก้ไขแล้วกดส่งขออนุมัติอีกครั้ง');
      router.push(form);
    }
  }

  if (r.status === 'rejected')
    return <button type="button" className={cls} id={`edit-${r.id}`} disabled={busy} onClick={reopen}>แก้ไขและส่งใหม่ · Edit &amp; resend</button>;

  if (r.status !== 'pending') return null;
  return (
    <>
      <button type="button" className={cls} id={`edit-${r.id}`} onClick={() => { setWhy(''); setAsk(true); }}>ดึงกลับมาแก้ไข · Recall &amp; edit</button>
      {ask && (
        <Modal title="ดึงคำขอกลับมาแก้ไข? · Recall to edit?" onClose={() => !busy && setAsk(false)}>
          <p style={{ margin: 0 }}><b className="mono">{r.no}</b> จะกลับเป็นฉบับร่างเพื่อแก้ไข เลขที่และประวัติยังอยู่เหมือนเดิม</p>
          <ul className="note" style={{ margin: 0, paddingLeft: 18 }}>
            <li>ผู้อนุมัติที่อนุมัติไปแล้วและคนที่กำลังรออนุมัติจะได้รับแจ้ง</li>
            <li>เมื่อส่งใหม่ ต้องอนุมัติใหม่ตั้งแต่ผู้อนุมัติคนแรก · Approval starts again from the first approver</li>
          </ul>
          <label className="f" htmlFor="recall-why">เหตุผล (ถ้ามี) · Reason
            <input className="in" id="recall-why" value={why} maxLength={500} placeholder="เช่น แก้จำนวนสินค้า / แนบใบเสนอราคาเพิ่ม" onChange={(e) => setWhy(e.target.value)} />
          </label>
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" disabled={busy} onClick={() => setAsk(false)}>ไม่ดึงกลับ · Keep</button>
            <button type="button" className="btn p" id="recall-confirm" disabled={busy} onClick={recall}>{busy ? 'กำลังดึงกลับ…' : 'ดึงกลับมาแก้ไข · Recall'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
