'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { LIST_COLS, Loading, PageHead, ReqTable } from '@/components/ui';
import { DeleteRequestButton, canDelete } from '@/components/DeleteRequest';
import { EditRequestButton } from '@/components/EditRequest';
import { PdfButton } from '@/components/PdfButton';
import type { RequestRow } from '@/lib/types';

export default function MyRequests() {
  const { sb, uid, bump, has, toast } = useApp();
  const [list, setList] = useState<RequestRow[] | null>(null);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      // 0019: also drafts handed to me by another preparer, and requests I drafted that the buyer sent
      let res: { data: unknown; error: unknown } = await sb.from('requests').select(`${LIST_COLS},handoff,handed_from`)
        .or(`preparer_id.eq.${uid},created_by.eq.${uid},handed_from.eq.${uid},and(status.eq.draft,handoff.is.true,buyer_id.eq.${uid})`)
        .order('created_at', { ascending: false }).limit(200);
      if (res.error) // SQL 0019 not run yet
        res = await sb.from('requests').select(LIST_COLS).or(`preparer_id.eq.${uid},created_by.eq.${uid}`).order('created_at', { ascending: false }).limit(200);
      if (res.error) toast('bad', 'โหลดรายการไม่สำเร็จ · Could not load the list', 'ตรวจอินเทอร์เน็ตแล้วเปิดหน้านี้ใหม่ · Check your connection and reload');
      setList((res.data as unknown as RequestRow[]) || []);
    })();
  }, [sb, uid, bump, toast]);

  const c = (s: string) => (list || []).filter((r) => r.status === s).length;
  /** a draft another preparer handed to me: I may edit and send it, not delete it */
  const toMe = (r: RequestRow) => r.status === 'draft' && !!r.handoff && r.buyer_id === uid && r.preparer_id !== uid && r.created_by !== uid;
  const mine = (r: RequestRow) => r.preparer_id === uid || r.created_by === uid;
  const handedIn = (list || []).filter(toMe);
  return (
    <>
      <PageHead title="คำขออนุมัติของฉัน" lead="My approval requests — see which approver each one is waiting on">
        {(has('preparer') || has('admin')) && <Link className="btn p" href="/requests/new">+ สร้างคำขอใหม่ · New request</Link>}
      </PageHead>
      <div className="tiles">
        <div className="tile"><span>ฉบับร่าง · Draft</span><b>{c('draft')}</b></div>
        <div className="tile"><span>รออนุมัติ · Pending</span><b>{c('pending')}</b></div>
        <div className="tile"><span>อนุมัติแล้ว · Approved</span><b>{c('approved')}</b></div>
        <div className="tile"><span>ไม่อนุมัติ · Rejected</span><b>{c('rejected')}</b></div>
      </div>
      {handedIn.length > 0 && (
        <div className="ok-box" id="handed-in" role="status">
          <b>มีร่างคำขอส่งต่อมาให้คุณ {handedIn.length} รายการ · {handedIn.length} draft(s) handed to you</b> — กด “แก้ไข” เพื่อตรวจและส่งขออนุมัติ เมื่อส่งแล้วคุณจะเป็นผู้จัดทำ
        </div>
      )}
      {list === null ? <Loading /> : <ReqTable list={list} empty='ยังไม่มีคำขอ กด "สร้างคำขอใหม่" เพื่อเริ่ม · No requests yet — press New request to start'
        actions={(r) => (
          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <PdfButton r={r} />
            {['draft', 'rejected'].includes(r.status) && (mine(r) || toMe(r)) && <EditRequestButton r={r} sm />}
            {canDelete(r) && mine(r) && <DeleteRequestButton r={r} />}
          </span>
        )} />}
    </>
  );
}
