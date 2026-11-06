import { itemsOf, netOf, compNets } from './calc';
import { SUBJ, ST } from './format';
import type { RequestRow, RequestStep } from './types';

type Ctx = {
  name: (id?: string | null) => string;
  deptTh: (id?: string | null) => string;
  posTh: (code?: string | null) => string;
  companyTh: (id?: string | null) => string;
};
type Row = RequestRow & { request_steps?: RequestStep[] };

/** Excel has no time zones: write the viewer's local clock time */
const d8 = (v?: string | null) => {
  if (!v) return null;
  const t = new Date(v);
  return new Date(t.getTime() - t.getTimezoneOffset() * 60000);
};
const STEP: Record<string, string> = { waiting: 'รอคิว', pending: 'รออนุมัติ', approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก', skipped: 'ข้าม' };

/** Vendor bought from per item: parts of a split, or the ✓ vendor (older requests: เจ้าที่ 1). */
function bought(r: Row) {
  const items = itemsOf(r);
  const comps = r.no_comp ? [] : r.comparisons || [];
  const vname = (v: number) => (v === 0 ? r.vendor : comps[v - 1]?.vendor || '');
  const net = (v: number, k: number) => (v === 0 ? netOf(items[k]) : compNets(comps[v - 1], items.length)[k]);
  return items.map((it, k) => {
    if (it.split?.length)
      return it.split.map((x) => ({ it, k, vendor: vname(x.v), qty: Number(x.qty), net: x.net ?? net(x.v, k), line: x.line ?? Math.round(net(x.v, k) * Number(x.qty) * 100) / 100, split: true }));
    const v = it.award != null && it.award >= 0 && it.award <= comps.length ? it.award : 0;
    const n0 = net(v, k);
    return [{ it, k, vendor: vname(v), qty: it.qty, net: n0, line: it.award_line ?? (v === 0 ? it.line_total ?? n0 * it.qty : Number(comps[v - 1]?.lines?.[k] ?? n0 * it.qty)), split: false }];
  });
}

/** Two sheets: one row per request, and one row per item (a split item = one row per vendor). */
export async function exportHistory(rows: Row[], ctx: Ctx, filename: string) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const H = (v: string) => ({ value: v, fontWeight: 'bold' as const, backgroundColor: '#EFE6DA' });
  const T = (v: string | null | undefined) => ({ value: v ?? '', type: String });
  const N = (v: number | null | undefined, fmt = '#,##0.00') => (v == null ? { value: '' , type: String } : { value: Number(v), type: Number, format: fmt });
  const D = (v?: string | null) => (v ? { value: d8(v) as Date, type: Date, format: 'dd/mm/yyyy hh:mm' } : { value: '', type: String });

  const reqHead = ['เลขที่', 'รายงานเลขที่', 'สถานะ', 'วันที่สร้าง', 'วันที่ส่ง', 'วันที่อนุมัติครบ', 'เรื่อง', 'ฝ่ายที่ขอซื้อ', 'บริษัทผู้ซื้อ', 'ผู้จัดทำ', 'ผู้ซื้อ',
    'ผู้ขายที่สั่งซื้อ (✓)', 'จำนวนรายการ', 'ยอดก่อน VAT', 'VAT', 'ยอดรวม', 'ลำดับผู้อนุมัติ'];
  const itemHead = ['เลขที่', 'สถานะ', 'รายการที่', 'SKU', 'ชื่อสินค้า', 'รายละเอียด', 'จำนวนทั้งหมด', 'หน่วย', 'ผู้ขายที่สั่งซื้อ', 'จำนวนที่ซื้อ', 'ราคาสุทธิ/หน่วย', 'ยอดก่อน VAT', 'แบ่งซื้อ', 'เหตุผล'];
  const reqData: unknown[][] = [reqHead.map(H)];
  const itemData: unknown[][] = [itemHead.map(H)];
  for (const r of rows) {
    const b = bought(r);
    const vendors = Array.from(new Set(b.flat().map((x) => x.vendor).filter(Boolean)));
    const steps = [...(r.request_steps || [])].sort((a, z) => a.step_no - z.step_no)
      .map((s) => `${ctx.posTh(s.position)}: ${ctx.name(s.signer_id || s.approver_id)} (${STEP[s.status] || s.status})`).join(' → ');
    reqData.push([
      T(r.no || 'ฉบับร่าง'), T(r.report_no), T(ST[r.status]?.[0] || r.status), D(r.created_at), D(r.submitted_at), D(r.completed_at),
      T(SUBJ[r.subject_type] || r.subject_type), T(ctx.deptTh(r.dept)), T(ctx.companyTh(r.company_id)), T(ctx.name(r.preparer_id)), T(ctx.name(r.buyer_id)),
      T(vendors.join(' + ')), N(itemsOf(r).length, '0'), N(r.subtotal), N(r.vat), N(r.total), T(steps),
    ]);
    for (const parts of b)
      for (const x of parts)
        itemData.push([
          T(r.no || 'ฉบับร่าง'), T(ST[r.status]?.[0] || r.status), N(x.k + 1, '0'), T(x.it.sku), T(x.it.product_name), T(x.it.description),
          N(x.it.qty, '#,##0.####'), T(x.it.unit), T(x.vendor), N(x.qty, '#,##0.####'), N(x.net), N(x.line), T(x.split ? 'แบ่งซื้อ' : ''), T(x.it.award_reason),
        ]);
  }
  await writeExcelFile([
    { data: reqData as never, sheet: 'คำขอ', stickyRowsCount: 1, columns: [14, 14, 12, 16, 16, 16, 16, 20, 30, 18, 18, 36, 10, 14, 12, 14, 60].map((width) => ({ width })) },
    { data: itemData as never, sheet: 'รายการสินค้า', stickyRowsCount: 1, columns: [14, 12, 9, 14, 30, 30, 12, 8, 32, 12, 14, 14, 10, 40].map((width) => ({ width })) },
  ]).toFile(filename);
}
