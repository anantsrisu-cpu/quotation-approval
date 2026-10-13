'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { LIST_COLS, Loading, PageHead, ReqTable } from '@/components/ui';
import { ST } from '@/lib/format';
import type { RequestRow } from '@/lib/types';

const PAGE = 50;

/** Everything the signed-in person is allowed to see (database rules decide). */
export default function History() {
  const { sb, bump } = useApp();
  const [q, setQ] = useState('');
  const [st, setSt] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const t = setTimeout(async () => {
      let query = sb.from('requests').select(LIST_COLS, { count: 'exact' }).order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (st !== 'all') query = query.eq('status', st);
      if (from) query = query.gte('created_at', from);
      if (to) query = query.lte('created_at', to + 'T23:59:59');
      const term = q.trim().replace(/[%,()]/g, '');
      if (term) query = query.or(`no.ilike.%${term}%,product_name.ilike.%${term}%,sku.ilike.%${term}%,vendor.ilike.%${term}%`);
      const { data, count } = await query;
      setRows((data as unknown as RequestRow[]) || []);
      setTotal(count || 0);
    }, 250);
    return () => clearTimeout(t);
  }, [sb, q, st, from, to, page, bump]);

  return (
    <>
      <PageHead title="ประวัติและค้นหา" lead="History & search — open any request to see everything that happened" />
      <div className="card">
        <div className="grid">
          <label className="f span2" htmlFor="h-q">ค้นหา · Search
            <input className="in" type="search" id="h-q" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="เลขที่ สินค้า SKU หรือผู้ขาย · Number, product, SKU, vendor" />
          </label>
          <label className="f" htmlFor="h-st">สถานะ · Status
            <select className="in" id="h-st" value={st} onChange={(e) => { setSt(e.target.value); setPage(0); }}>
              <option value="all">ทั้งหมด · All</option>
              {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[0]} · {v[1]}</option>)}
            </select>
          </label>
          <label className="f" htmlFor="h-from">ตั้งแต่วันที่ · From<input className="in" type="date" id="h-from" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></label>
          <label className="f" htmlFor="h-to">ถึงวันที่ · To<input className="in" type="date" id="h-to" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></label>
        </div>
      </div>
      {rows === null ? <Loading /> : <ReqTable list={rows} empty="ไม่พบคำขอที่ตรงกับการค้นหา · No matching requests" />}
      {total > PAGE && (
        <div className="pager">
          <span className="note">{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} จาก {total}</span>
          <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← ก่อนหน้า</button>
          <button className="btn sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>ถัดไป →</button>
        </div>
      )}
    </>
  );
}
