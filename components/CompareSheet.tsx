'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useApp } from './AppProvider';
import { compDiscounts, compNets, compPrices, itemsOf, netOf, normDiscount } from '@/lib/calc';
import { dOnly, r2 } from '@/lib/format';
import { renderSheet, type SheetData, type SheetSigner, type SheetVendor } from '@/lib/compareSheet';
import type { RequestRow, RequestStep } from '@/lib/types';

/** Turn a request into the data of the landscape comparison sheet. */
export function useSheetData(r: RequestRow, steps: RequestStep[], draft: boolean, rev: number): SheetData {
  const { company, companies, logoUrl, deptTh, name, people, posTh, positions } = useApp();
  const co = company(r.company_id);
  const items = itemsOf(r);
  const n = items.length;
  const comps = r.no_comp ? [] : r.comparisons || [];
  const rate = r.vat_rate || 0.07;
  // vendor ticked ✓ per item (older requests: everything from เจ้าที่ 1)
  const award = items.map((it) => (it.award != null && it.award >= 0 && it.award <= comps.length ? it.award : 0));

  const line1 = items.map((it) => it.line_total ?? r2(netOf(it) * it.qty));
  // เจ้าที่ 1's whole quotation (r.subtotal is the amount approved = the ✓ lines)
  const sub1 = r2(line1.reduce((s, x) => s + x, 0));
  const selected: SheetVendor = {
    name: r.vendor,
    unit: items.map((it) => it.unit_price),
    disc: items.map((it) => normDiscount(it.discount)),
    net: items.map((it) => netOf(it)),
    line: line1,
    subtotal: sub1,
    vat: r2(sub1 * rate),
    total: r2(sub1 + r2(sub1 * rate)),
    warranty: r.warranty || '',
    leadDays: r.lead_days ?? null,
    creditDays: r.credit_days ?? null,
    delivery: r.delivery || [],
  };
  const others: SheetVendor[] = comps.map((c) => {
    const net = compNets(c, n);
    const line = items.map((it, k) => (c.lines && c.lines[k] != null ? Number(c.lines[k]) : r2(net[k] * it.qty)));
    const subtotal = c.subtotal ?? r2(line.reduce((s, x) => s + x, 0));
    const total = c.total ?? r2(subtotal + r2(subtotal * (r.vat_rate || 0.07)));
    return {
      name: c.vendor,
      unit: compPrices(c),
      disc: compDiscounts(c, n),
      net,
      line,
      subtotal,
      vat: r2(total - subtotal),
      total,
      warranty: c.warranty || '',
      leadDays: c.lead_days ?? null,
      creditDays: c.credit_days ?? null,
      delivery: c.delivery || [],
    };
  });
  const vendors = [selected, ...others];
  // แบ่งซื้อ parts (older requests: none)
  const splitOf = (k: number) =>
    (items[k].split || []).filter((x) => x.v >= 0 && x.v < vendors.length).map((x) => ({
      v: x.v, qty: Number(x.qty), pct: x.pct ?? r2((Number(x.qty) / (items[k].qty || 1)) * 100), line: x.line ?? r2(vendors[x.v].net[k] * Number(x.qty)),
    }));
  vendors.forEach((v, vi) => {
    v.awarded = r2(award.reduce((s, a, k) => {
      const sp = splitOf(k);
      if (sp.length) return s + sp.filter((x) => x.v === vi).reduce((t, x) => t + x.line, 0);
      return s + (a === vi ? v.line[k] : 0);
    }, 0));
    v.selected = v.awarded > 0;
  });

  const ordered = [...steps].sort((a, b) => a.step_no - b.step_no);
  const note = (code: string) => positions.find((p) => p.code === code)?.note || '';
  const prep = people[r.preparer_id];
  const stepBox = (s: RequestStep, heading: string): SheetSigner => ({
    heading,
    range: note(s.position),
    caption: 'Approved by',
    name: name(s.signer_id || s.approver_id),
    position: posTh(s.position),
    date: s.status === 'approved' ? dOnly(s.acted_at) : '',
    signature: s.status === 'approved' ? s.signature : null,
    note: s.on_behalf_of ? `อนุมัติแทน ${name(s.on_behalf_of)}` : '',
  });
  // one box per approver position (from the plan saved at sending); older requests: one per step
  const plan = r.sign_plan && r.sign_plan.length ? r.sign_plan : null;
  const approvers: SheetSigner[] = plan
    ? plan.map((e, i) => {
        const heading = `ผู้อนุมัติ (${i + 1})`;
        const st = e.mode === 'online' ? ordered.find((s) => s.step_no === e.step_no) : undefined;
        if (st) return stepBox(st, heading);
        return {
          heading,
          range: note(e.position),
          caption: 'Approved by',
          name: e.approver_id ? name(e.approver_id) : '',
          position: posTh(e.position),
          date: '',
          signature: null,
          // not needed for this amount: crossed out once the request is fully approved
          state: e.mode === 'wet' ? 'wet' : e.mode === 'skip' && r.status === 'approved' ? 'skip' : undefined,
        };
      })
    : ordered.map((s, i) => stepBox(s, `ผู้อนุมัติ (${i + 1})`));
  // remarks: what was typed in วัตถุประสงค์ / รายละเอียด, the reason for having no comparison,
  // and the reason for each item not bought from the lowest price
  const notes: string[] = [];
  if (r.details?.trim()) notes.push(`วัตถุประสงค์: ${r.details.trim()}`);
  if (r.no_comp && r.no_comp_reason?.trim()) notes.push(`เหตุผลที่ไม่มีคู่เทียบ: ${r.no_comp_reason.trim()}`);
  if (r.low_reason?.trim()) notes.push(`เหตุผลที่ไม่เลือกราคาต่ำสุด: ${r.low_reason.trim()}`);
  items.forEach((it, k) => {
    if (!it.award_reason?.trim()) return;
    const sp = splitOf(k);
    const what = sp.length
      ? `แบ่งซื้อ ${sp.map((x) => `เจ้าที่ ${x.v + 1} ${x.qty.toLocaleString('en-US')} ${it.unit} (${x.pct}%)`).join(' + ')}`
      : `ซื้อเจ้าที่ ${award[k] + 1} ${vendors[award[k]]?.name || ''}`;
    notes.push(`รายการที่ ${k + 1}${it.sku ? ` (${it.sku})` : ''}: ${what} — ${it.award_reason.trim()}`);
  });

  return {
    logoUrl: logoUrl(co),
    initials: co?.initials || 'CO',
    companies: companies.filter((c) => c.active || c.id === r.company_id).map((c) => ({ id: c.id, label: c.th })),
    companyId: r.company_id,
    info: [
      // typed on the request; otherwise the system number and the final-approval date
      ['เลขที่ใบขอซื้อ', r.report_no?.trim() || r.no || '(ยังไม่ออกเลข)'],
      ['วันที่อนุมัติ', r.report_date ? dOnly(r.report_date) : draft ? '(รออนุมัติ)' : dOnly(r.completed_at || r.letter_at)],
      ['ฝ่ายที่ขอซื้อ', deptTh(r.dept)],
    ],
    rev,
    items: items.map((it, k) => ({
      sku: it.sku,
      name: it.product_name || '',
      description: it.description || '',
      brand: it.brand || '',
      qty: it.qty,
      unit: it.unit,
      prevPrice: it.prev_price,
      prevVendor: it.prev_vendor || '',
      prevDate: it.prev_date || null,
      reportNo: it.report_no || '',
      award: award[k],
      split: splitOf(k).length ? splitOf(k) : null,
    })),
    vendors,
    vatRate: rate,
    notes,
    signers: [
      ...approvers.reverse(),
      {
        heading: 'ผู้จัดทำ',
        caption: 'Prepared by',
        name: prep?.name || '',
        position: prep?.title || '',
        date: dOnly(r.submitted_at),
        signature: r.preparer_signature,
        note: r.created_by && r.created_by !== r.preparer_id ? `จัดทำแทนโดย ${name(r.created_by)}` : '',
      },
    ],
    draft,
  };
}

/** The landscape sheet pages; `onReady` fires after every (re)layout. */
export function CompareSheet({ data, onReady }: { data: SheetData; onReady?: (pages: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(data);
  const ready = useRef(onReady);
  ready.current = onReady;
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    let stale = false;
    renderSheet(el, JSON.parse(key) as SheetData).then((p) => !stale && ready.current?.(p));
    return () => {
      stale = true;
    };
  }, [key]);
  // re-layout once the Thai web font has loaded (row heights change)
  useEffect(() => {
    document.fonts?.ready.then(() => host.current && renderSheet(host.current, JSON.parse(key) as SheetData).then((p) => ready.current?.(p)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="sheet-host" ref={host} />;
}
