'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { ST, dt, fmt, SUBJ } from '@/lib/format';
import type { RequestRow, RequestStatus, RequestStep } from '@/lib/types';
import { useApp } from './AppProvider';

export function Chip({ status }: { status: RequestStatus }) {
  const m = ST[status] || ST.draft;
  return <span className={`chip ${m[2]}`}>{m[0]} · {m[1]}</span>;
}

export function Chain({ r }: { r: Pick<RequestRow, 'status' | 'current_step'> & { request_steps?: RequestStep[] } }) {
  const { posTh } = useApp();
  const steps = [...(r.request_steps || [])].sort((a, b) => a.step_no - b.step_no);
  if (!steps.length) return null;
  return (
    <div className="chain" aria-label="ลำดับผู้อนุมัติ">
      {steps.map((s, i) => {
        const c = s.status === 'approved' ? 'ok' : s.status === 'rejected' ? 'no' : r.status === 'pending' && i === r.current_step ? 'wait' : 'todo';
        return (
          <span key={s.step_no} style={{ display: 'contents' }}>
            {i > 0 && <span className="bar" />}
            <span className={`dot ${c}`} title={posTh(s.position)}>{c === 'ok' ? '✓' : c === 'no' ? '✕' : ''}</span>
          </span>
        );
      })}
    </div>
  );
}

export function useStepText() {
  const { name, posTh } = useApp();
  return (r: RequestRow) => {
    const steps = [...(r.request_steps || [])].sort((a, b) => a.step_no - b.step_no);
    const cur = steps[r.current_step];
    if (r.status === 'pending' && cur) return `${r.current_step + 1}/${steps.length} · รอ ${name(cur.approver_id)} (${posTh(cur.position)})`;
    if (r.status === 'approved') return `${steps.length}/${steps.length} · อนุมัติครบ · Complete`;
    if (r.status === 'rejected') return 'ส่งกลับผู้จัดทำ · Returned';
    if (r.status === 'cancelled') return 'ยกเลิก · Cancelled';
    return 'ยังไม่ส่ง · Not sent';
  };
}

export function ReqTable({ list, empty, actions }: { list: RequestRow[]; empty?: string; actions?: (r: RequestRow) => React.ReactNode }) {
  const { name } = useApp();
  const stepText = useStepText();
  if (!list.length)
    return (
      <div className="card">
        <p className="lead" style={{ margin: 0 }}>{empty || 'ยังไม่มีคำขอ · No requests yet'}</p>
      </div>
    );
  return (
    <div className="tw">
      <table className="t">
        <thead>
          <tr>
            <th>เลขที่ · No.</th>
            <th>เรื่อง / สินค้า · Subject</th>
            <th style={{ textAlign: 'right' }}>ยอดรวม (บาท)</th>
            <th>ลำดับผู้อนุมัติ · Chain</th>
            <th>สถานะ · Status</th>
            {actions && <th><span className="sr">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/requests/${r.id}`} className="mono" style={{ fontSize: 13 }}>{r.no || 'ฉบับร่าง'}</Link>
                <div className="note">{dt(r.submitted_at || r.created_at)}</div>
              </td>
              <td>
                <Link href={`/requests/${r.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <b style={{ fontWeight: 500 }}>{SUBJ[r.subject_type]} · {r.product_name || r.sku || '—'}</b>
                </Link>
                <div className="note">{r.vendor || '—'} · {name(r.preparer_id)}{r.created_by && r.created_by !== r.preparer_id ? ` · จัดทำแทนโดย ${name(r.created_by)}` : ''}</div>
              </td>
              <td className="num" style={{ textAlign: 'right' }}>{r.total ? fmt(r.total) : '—'}</td>
              <td>
                <Chain r={r} />
                <div className="note" style={{ marginTop: 4 }}>{stepText(r)}</div>
              </td>
              <td><Chip status={r.status} /></td>
              {actions && <td style={{ whiteSpace: 'nowrap' }}>{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="ov" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'dlg' : 'dlg small'}>
        <div className="dlg-h">
          <h2>{title}</h2>
          <button className="btn sm" onClick={onClose}>ปิด · Close</button>
        </div>
        <div className="dlg-b">{children}</div>
      </div>
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-busy="true" aria-label="กำลังโหลด · Loading">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" />)}
    </div>
  );
}

export function PageHead({ title, lead, children }: { title: React.ReactNode; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="head">
      <div style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {children && <div className="row" style={{ gap: 10 }}>{children}</div>}
    </div>
  );
}

/** Columns used by every request list (no signature images). */
export const LIST_COLS =
  'id,no,status,preparer_id,created_by,subject_type,sku,product_name,total,vendor,dept,created_at,submitted_at,current_step,step_since,completed_at,buyer_id,request_steps(step_no,position,approver_id,status,signer_id,on_behalf_of)';
