'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { AdminGate } from '@/components/AdminGate';
import { LIST_COLS, Loading, Modal, PageHead, ReqTable } from '@/components/ui';
import { ST, dt } from '@/lib/format';
import type { RequestRow } from '@/lib/types';

const PAGE = 50;

function Overview() {
  const { sb, bump, people, posTh, run, toast, refresh, name } = useApp();
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [apps, setApps] = useState(0);
  const [errs, setErrs] = useState(0);
  const [sigIds, setSigIds] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [st, setSt] = useState('pending');
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState<null | { kind: 'reassign' | 'cancel'; r: RequestRow }>(null);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const statuses = ['pending', 'approved', 'rejected', 'draft', 'cancelled'];
      const res = await Promise.all(statuses.map((s) => sb.from('requests').select('id', { count: 'exact', head: true }).eq('status', s)));
      const c: Record<string, number> = {};
      statuses.forEach((s, i) => (c[s] = res[i].count || 0));
      setCounts(c);
      const [a, e, sg] = await Promise.all([
        sb.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        sb.from('app_errors').select('id', { count: 'exact', head: true }).in('status', ['open', 'investigating']),
        sb.from('signatures').select('user_id'),
      ]);
      setApps(a.count || 0);
      setErrs(e.count || 0);
      setSigIds(new Set((sg.data || []).map((x) => x.user_id)));
    })();
  }, [sb, bump]);

  useEffect(() => {
    const t = setTimeout(async () => {
      let query = sb.from('requests').select(LIST_COLS, { count: 'exact' }).order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (st !== 'all') query = query.eq('status', st);
      const term = q.trim().replace(/[%,()]/g, '');
      if (term) query = query.or(`no.ilike.%${term}%,product_name.ilike.%${term}%,sku.ilike.%${term}%,vendor.ilike.%${term}%`);
      const { data, count } = await query;
      setRows((data as unknown as RequestRow[]) || []);
      setTotal(count || 0);
    }, 250);
    return () => clearTimeout(t);
  }, [sb, q, st, page, bump]);

  const approvers = Object.values(people).filter((p) => p.status === 'active' && p.roles.includes('approver'));
  const noSig = approvers.filter((p) => !sigIds.has(p.id));

  async function remind(r: RequestRow) {
    const { ok } = await run('admin_remind', sb.rpc('admin_remind', { p_id: r.id }));
    if (ok) toast('ok', 'ส่งเตือนแล้ว · Reminder sent', 'ผู้อนุมัติจะเห็นในการแจ้งเตือน · The approver will see it in notifications');
  }
  async function confirm() {
    if (!modal) return;
    if (!reason.trim() || (modal.kind === 'reassign' && !to)) return toast('bad', 'ข้อมูลไม่ครบ · Missing info', 'ระบุเหตุผล' + (modal.kind === 'reassign' ? 'และเลือกผู้อนุมัติ' : ''));
    setBusy(true);
    const { ok } = modal.kind === 'reassign'
      ? await run('admin_reassign', sb.rpc('admin_reassign', { p_id: modal.r.id, p_to: to, p_reason: reason.trim() }))
      : await run('cancel_request', sb.rpc('cancel_request', { p_id: modal.r.id, p_reason: reason.trim() }));
    setBusy(false);
    if (ok) {
      toast('ok', modal.kind === 'reassign' ? 'เปลี่ยนผู้อนุมัติแล้ว · Reassigned' : 'ยกเลิกคำขอแล้ว · Cancelled', modal.r.no || '');
      setModal(null);
      refresh();
    }
  }

  const curApprover = (r: RequestRow) => (r.request_steps || []).find((s) => s.step_no === r.current_step)?.approver_id;

  return (
    <>
      <PageHead title="ภาพรวมและควบคุมคำขอ" lead="Overview & process control — see every request and step in at any point. Every action is logged." />
      <div className="tiles">
        <div className="tile"><span>รออนุมัติ · Pending</span><b>{counts.pending ?? '…'}</b></div>
        <div className="tile"><span>อนุมัติแล้ว · Approved</span><b>{counts.approved ?? '…'}</b></div>
        <div className="tile"><span>ไม่อนุมัติ · Rejected</span><b>{counts.rejected ?? '…'}</b></div>
        <div className="tile"><span>รอเปิดบัญชี · Applications</span><b>{apps}</b></div>
        <div className="tile"><span>ปัญหาที่ยังเปิด · Open issues</span><b>{errs}</b></div>
        <div className="tile"><span>ผู้อนุมัติไม่มีลายเซ็น</span><b>{noSig.length}</b></div>
      </div>
      {apps > 0 && <div className="warn-box">มีคำขอเปิดบัญชีรอตรวจ {apps} รายการ · {apps} account application(s) waiting — <Link href="/admin/applications">ตรวจเลย · Review</Link></div>}
      {noSig.length > 0 && <div className="warn-box">ผู้อนุมัติยังไม่มีลายเซ็น: {noSig.map((u) => u.name).join(', ')} — <Link href="/admin/users">เพิ่มลายเซ็น · Add signature</Link></div>}
      {errs > 0 && <div className="bad-box">มีปัญหาที่ยังไม่ปิด {errs} รายการ · {errs} open issue(s) — <Link href="/admin/errors">ดูสถานะปัญหา · See issues</Link></div>}

      <div className="card">
        <div className="grid">
          <label className="f span2" htmlFor="a-q">ค้นหา · Search
            <input className="in" type="search" id="a-q" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="เลขที่ สินค้า SKU ผู้ขาย · Number, product, SKU, vendor" />
          </label>
          <label className="f" htmlFor="a-st">สถานะ · Status
            <select className="in" id="a-st" value={st} onChange={(e) => { setSt(e.target.value); setPage(0); }}>
              <option value="all">ทั้งหมด · All</option>
              {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[0]} · {v[1]}</option>)}
            </select>
          </label>
        </div>
      </div>
      {rows === null ? <Loading /> : (
        <ReqTable
          list={rows}
          empty="ไม่พบคำขอ · No requests"
          actions={(r) => r.status === 'pending' ? (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => remind(r)}>เตือน · Remind</button>
              <button className="btn sm" onClick={() => { setTo(''); setReason(''); setModal({ kind: 'reassign', r }); }}>เปลี่ยนผู้อนุมัติ</button>
              <button className="btn sm d" onClick={() => { setReason(''); setModal({ kind: 'cancel', r }); }}>ยกเลิก</button>
            </div>
          ) : r.completed_at ? <span className="note">ปิด {dt(r.completed_at)}</span> : null}
        />
      )}
      {total > PAGE && (
        <div className="pager">
          <span className="note">{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} จาก {total}</span>
          <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← ก่อนหน้า</button>
          <button className="btn sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>ถัดไป →</button>
        </div>
      )}

      {modal && (
        <Modal title={modal.kind === 'reassign' ? 'เปลี่ยนผู้อนุมัติขั้นนี้ · Reassign step' : 'ยกเลิกคำขอ · Cancel request'} onClose={() => setModal(null)}>
          <div className="box" style={{ borderStyle: 'solid' }}><b className="mono">{modal.r.no}</b> · {modal.r.product_name}{modal.kind === 'reassign' && <> · ตอนนี้รอ {name(curApprover(modal.r))}</>}</div>
          {modal.kind === 'reassign' && (
            <label className="f" htmlFor="m-to">ผู้อนุมัติคนใหม่ · New approver <span className="req">*</span>
              <select className="in" id="m-to" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">— เลือก · Select —</option>
                {approvers.filter((p) => p.id !== curApprover(modal.r)).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {posTh(p.position)}{sigIds.has(p.id) ? '' : ' (ยังไม่มีลายเซ็น)'}</option>
                ))}
              </select>
            </label>
          )}
          <label className="f" htmlFor="m-why">เหตุผล · Reason <span className="req">*</span>
            <textarea className="in" id="m-why" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setModal(null)}>ปิด · Close</button>
            <button className={`btn ${modal.kind === 'cancel' ? 'd' : 'p'}`} disabled={busy} onClick={confirm}>ยืนยัน · Confirm</button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function AdminPage() {
  return <AdminGate><Overview /></AdminGate>;
}
