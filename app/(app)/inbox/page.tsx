'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { LIST_COLS, Loading, PageHead, ReqTable } from '@/components/ui';
import { SUBJ, dt, fmt } from '@/lib/format';
import type { RequestRow } from '@/lib/types';

export default function Inbox() {
  const { sb, uid, bump, name } = useApp();
  const [waiting, setWaiting] = useState<RequestRow[] | null>(null);
  const [done, setDone] = useState<RequestRow[]>([]);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      const [p, d] = await Promise.all([
        sb.from('request_steps').select('request_id').eq('approver_id', uid).eq('status', 'pending'),
        sb.from('request_steps').select('request_id,acted_at').or(`signer_id.eq.${uid},on_behalf_of.eq.${uid}`).in('status', ['approved', 'rejected']).order('acted_at', { ascending: false }).limit(20),
      ]);
      const wIds = (p.data || []).map((x) => x.request_id);
      const dIds = Array.from(new Set((d.data || []).map((x) => x.request_id)));
      const [w, dd] = await Promise.all([
        wIds.length ? sb.from('requests').select(LIST_COLS).in('id', wIds).eq('status', 'pending').order('step_since') : Promise.resolve({ data: [] }),
        dIds.length ? sb.from('requests').select(LIST_COLS).in('id', dIds) : Promise.resolve({ data: [] }),
      ]);
      setWaiting((w.data as unknown as RequestRow[]) || []);
      const order = new Map(dIds.map((id, i) => [id, i]));
      setDone((((dd.data as unknown as RequestRow[]) || []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))));
    })();
  }, [sb, uid, bump]);

  const list = waiting || [];
  return (
    <>
      <PageHead title="คำขอที่รอคุณอนุมัติ" lead="Requests waiting for your approval — only those at your step" />
      <div className="tiles">
        <div className="tile"><span>รอคุณ · Waiting</span><b>{list.length}</b></div>
        <div className="tile"><span>ยอดรวมที่รอ (บาท)</span><b className="num" style={{ fontSize: 20 }}>{fmt(list.reduce((a, r) => a + (r.total || 0), 0))}</b></div>
        <div className="tile"><span>ตัดสินใจล่าสุด · Decided</span><b>{done.length}</b></div>
      </div>
      {waiting === null ? <Loading /> : list.length ? (
        list.map((r) => {
          const steps = [...(r.request_steps || [])].sort((a, b) => a.step_no - b.step_no);
          const cur = steps[r.current_step];
          return (
            <div key={r.id} className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ flex: '999 1 320px', minWidth: 0 }}>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="mono note">{r.no}</span>
                  <span className="chip st-pend">ขั้น {r.current_step + 1} จาก {steps.length}{r.current_step === steps.length - 1 ? ' (สุดท้าย)' : ''}</span>
                  {cur?.on_behalf_of && <span className="chip st-draft">อนุมัติแทน {name(cur.on_behalf_of)}</span>}
                </div>
                <b style={{ fontSize: 17 }}>{SUBJ[r.subject_type]} · {r.product_name}</b>
                <div className="note">{r.vendor} · ผู้จัดทำ {name(r.preparer_id)} · รอตั้งแต่ {dt(r.step_since || r.submitted_at)}</div>
              </div>
              <div style={{ flex: '1 1 140px', textAlign: 'right' }}>
                <span className="note">ยอดรวม</span>
                <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{fmt(r.total)}</div>
              </div>
              <Link className="btn p" href={`/requests/${r.id}`}>ตรวจและลงนาม · Review &amp; sign →</Link>
            </div>
          );
        })
      ) : (
        <div className="card"><p className="lead" style={{ margin: 0 }}>ไม่มีคำขอรอคุณตอนนี้ · Nothing waiting for you right now</p></div>
      )}
      <h2>ตัดสินใจล่าสุด · Recent decisions</h2>
      <ReqTable list={done} empty="ยังไม่มี · None yet" />
    </>
  );
}
