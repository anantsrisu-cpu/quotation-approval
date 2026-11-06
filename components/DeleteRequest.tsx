'use client';
import { useState } from 'react';
import { useApp } from './AppProvider';
import { Modal } from './ui';
import type { RequestRow } from '@/lib/types';

/** Requests that were never approved can be deleted by their preparer. */
export const canDelete = (r: Pick<RequestRow, 'status'>) => r.status === 'draft' || r.status === 'rejected' || r.status === 'cancelled';

/** ลบ button for the My requests list, with an in-page confirmation. */
export function DeleteRequestButton({ r }: { r: RequestRow }) {
  const { sb, run, toast, refresh } = useApp();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const label = r.no || 'ฉบับร่าง';
  async function go() {
    setBusy(true);
    // attachments first (the storage rule checks the request still exists), then the request itself
    const { data: files } = await sb.from('request_files').select('path').eq('request_id', r.id);
    const paths = (files || []).map((f: { path: string }) => f.path);
    if (paths.length) await sb.storage.from('attachments').remove(paths);
    const { ok } = await run('delete-request', sb.rpc('delete_request', { p_id: r.id }));
    setBusy(false);
    if (ok) {
      setAsk(false);
      toast('ok', 'ลบคำขอแล้ว · Request deleted', label);
      refresh();
    }
  }
  return (
    <>
      <button type="button" className="btn sm d" id={`del-${r.id}`} onClick={() => setAsk(true)} aria-label={`ลบคำขอ ${label}`}>ลบ · Delete</button>
      {ask && (
        <Modal title="ลบคำขอนี้? · Delete this request?" onClose={() => !busy && setAsk(false)}>
          <p style={{ margin: 0 }}>
            <b className="mono">{label}</b> · {r.product_name || r.sku || r.vendor || '—'}
          </p>
          <p className="note" style={{ margin: 0 }}>คำขอ ไฟล์แนบ และประวัติของคำขอนี้จะถูกลบถาวร กู้คืนไม่ได้ · The request, its files and history are removed for good.</p>
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" disabled={busy} onClick={() => setAsk(false)}>ไม่ลบ · Keep</button>
            <button type="button" className="btn" id="del-confirm" disabled={busy} onClick={go} style={{ background: "var(--bad-solid)", borderColor: "var(--bad-solid)", color: "#fff" }}>{busy ? 'กำลังลบ…' : 'ลบถาวร · Delete'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
