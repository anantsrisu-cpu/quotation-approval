'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { LIST_COLS, Loading, PageHead, ReqTable } from '@/components/ui';
import type { RequestRow } from '@/lib/types';

export default function MyRequests() {
  const { sb, uid, bump, has } = useApp();
  const [list, setList] = useState<RequestRow[] | null>(null);

  useEffect(() => {
    if (!uid) return;
    sb.from('requests').select(LIST_COLS).eq('preparer_id', uid).order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setList((data as unknown as RequestRow[]) || []));
  }, [sb, uid, bump]);

  const c = (s: string) => (list || []).filter((r) => r.status === s).length;
  return (
    <>
      <PageHead title="คำขออนุมัติของฉัน" lead="My approval requests — see which approver each one is waiting on">
        {has('preparer') && <Link className="btn p" href="/requests/new">+ สร้างคำขอใหม่ · New request</Link>}
      </PageHead>
      <div className="tiles">
        <div className="tile"><span>ฉบับร่าง · Draft</span><b>{c('draft')}</b></div>
        <div className="tile"><span>รออนุมัติ · Pending</span><b>{c('pending')}</b></div>
        <div className="tile"><span>อนุมัติแล้ว · Approved</span><b>{c('approved')}</b></div>
        <div className="tile"><span>ไม่อนุมัติ · Rejected</span><b>{c('rejected')}</b></div>
      </div>
      {list === null ? <Loading /> : <ReqTable list={list} empty='ยังไม่มีคำขอ กด "สร้างคำขอใหม่" เพื่อเริ่ม · No requests yet — press New request to start' />}
    </>
  );
}
