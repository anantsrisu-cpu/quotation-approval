'use client';
import { compDiscounts, compNets, compPrices, daysText, itemsOf, netOf, normDiscount } from '@/lib/calc';
import { dOnly, fmt, fmtQty, r2 } from '@/lib/format';
import type { RequestRow } from '@/lib/types';

const R = { textAlign: 'right' as const };

/** Percentage change vs the previous price, coloured (up = red, down = green). */
export function PrevPct({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span className="note">—</span>;
  const up = pct > 0;
  return (
    <span style={{ color: up ? 'var(--bad)' : pct < 0 ? 'var(--sage-ink)' : 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
      {up ? '▲ +' : pct < 0 ? '▼ ' : ''}{pct.toFixed(2)}%
    </span>
  );
}

/** Line items of a request: SKU, description, quantity, prices, previous price and change. */
export function ItemsTable({ r }: { r: RequestRow }) {
  const items = itemsOf(r);
  const hasDisc = items.some((it) => normDiscount(it.discount));
  const span = hasDisc ? 8 : 6;
  return (
    <div className="tw">
      <table className="t" style={{ minWidth: hasDisc ? 900 : 720 }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}>#</th>
            <th>สินค้า · Item</th>
            <th style={R}>จำนวน</th>
            <th style={R}>ราคา/หน่วย ก่อน VAT</th>
            {hasDisc && <th style={R}>ส่วนลด</th>}
            {hasDisc && <th style={R}>ราคาสุทธิ/หน่วย</th>}
            <th style={R}>ราคาก่อนหน้า</th>
            <th style={R}>เปลี่ยนแปลง</th>
            <th style={R}>รวม ก่อน VAT</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const net = netOf(it);
            const pct = it.prev_diff_pct ?? (it.prev_price ? r2(((net - it.prev_price) / it.prev_price) * 100) : null);
            return (
              <tr key={i}>
                <td className="note">{i + 1}</td>
                <td>
                  <span className="mono" style={{ fontSize: 12 }}>{it.sku}</span> · {it.product_name || '—'}
                  {it.brand && <span className="chip st-draft" style={{ marginLeft: 6 }}>{it.brand}</span>}
                  {it.description && <div className="note" style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{it.description}</div>}
                </td>
                <td className="num" style={{ ...R, whiteSpace: 'nowrap' }}>{fmtQty(it.qty)} {it.unit}</td>
                <td className="num" style={R}>{fmt(it.unit_price)}</td>
                {hasDisc && <td className="num" style={R}>{normDiscount(it.discount) || '—'}</td>}
                {hasDisc && <td className="num" style={R}><b>{fmt(net)}</b></td>}
                <td className="num" style={R}>
                  {it.prev_price != null ? fmt(it.prev_price) : <span className="note">—</span>}
                  {(it.prev_vendor || it.prev_date) && <div className="note" style={{ whiteSpace: 'normal' }}>{[it.prev_vendor, it.prev_date ? dOnly(it.prev_date) : ''].filter(Boolean).join(' · ')}</div>}
                </td>
                <td style={R}><PrevPct pct={pct} /></td>
                <td className="num" style={R}>{fmt(it.line_total ?? r2(net * it.qty))}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr><td colSpan={span} style={R}>มูลค่ารวม ก่อน VAT · Subtotal</td><td className="num" style={R}>{fmt(r.subtotal)}</td></tr>
          <tr><td colSpan={span} style={R}>VAT {Math.round((r.vat_rate || 0.07) * 100)}%</td><td className="num" style={R}>{fmt(r.vat)}</td></tr>
          <tr><td colSpan={span} style={R}><b>ยอดรวมสุทธิ (บาท) · Net total</b></td><td className="num" style={R}><b>{fmt(r.total)}</b></td></tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Items × vendors: unit price of every vendor for every item, with totals and difference. */
export function CompareTable({ r }: { r: RequestRow }) {
  const items = itemsOf(r);
  const comps = r.comparisons || [];
  const n = items.length;
  const cell = (price: number, disc: string, net: number) => (
    <>
      {disc ? <><span className="note">{fmt(price)} ลด {disc}</span><br /><b>{fmt(net)}</b></> : fmt(price)}
    </>
  );
  return (
    <div className="tw">
      <table className="t cmp" style={{ minWidth: 420 + comps.length * 130 }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}>#</th>
            <th>สินค้า · Item</th>
            <th style={R}>จำนวน</th>
            <th className="sel" style={R}>{r.vendor} ✓</th>
            {comps.map((c, i) => <th key={i} style={R}>{c.vendor}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((it, k) => (
            <tr key={k}>
              <td className="note">{k + 1}</td>
              <td><span className="mono" style={{ fontSize: 12 }}>{it.sku}</span> · {it.product_name}</td>
              <td className="num" style={{ ...R, whiteSpace: 'nowrap' }}>{fmtQty(it.qty)} {it.unit}</td>
              <td className="num sel" style={R}>{cell(it.unit_price, normDiscount(it.discount), netOf(it))}</td>
              {comps.map((c, i) => <td key={i} className="num" style={R}>{cell(compPrices(c)[k] || 0, compDiscounts(c, n)[k], compNets(c, n)[k])}</td>)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>มูลค่ารวม ก่อน VAT · Subtotal</td>
            <td className="num sel" style={R}>{fmt(r.subtotal)}</td>
            {comps.map((c, i) => <td key={i} className="num" style={R}>{c.subtotal != null ? fmt(c.subtotal) : '—'}</td>)}
          </tr>
          <tr>
            <td colSpan={3}><b>รวม VAT · Total</b></td>
            <td className="num sel" style={R}><b>{fmt(r.total)}</b></td>
            {comps.map((c, i) => <td key={i} className="num" style={R}><b>{c.total != null ? fmt(c.total) : '—'}</b></td>)}
          </tr>
          <tr>
            <td colSpan={3}>ส่วนต่าง · Difference</td>
            <td className="sel" style={R}>ผู้ขายที่เลือก</td>
            {comps.map((c, i) => (
              <td key={i} className="num" style={{ ...R, fontWeight: 600, color: (c.diff || 0) >= 0 ? 'var(--sage-ink)' : 'var(--bad)' }}>
                {c.diff != null ? `${c.diff >= 0 ? '+' : '−'}${fmt(Math.abs(c.diff))}` : '—'}
              </td>
            ))}
          </tr>
          <tr>
            <td colSpan={3}>การรับประกัน · Warranty</td>
            <td className="sel" style={R}>{r.warranty || '—'}</td>
            {comps.map((c, i) => <td key={i} style={R}>{c.warranty || '—'}</td>)}
          </tr>
          <tr>
            <td colSpan={3}>เครดิต · Credit</td>
            <td className="sel" style={R}>{daysText(r.credit_days)}</td>
            {comps.map((c, i) => <td key={i} style={R}>{daysText(c.credit_days)}</td>)}
          </tr>
          <tr>
            <td colSpan={3}>Lead time</td>
            <td className="sel" style={R}>{daysText(r.lead_days)}</td>
            {comps.map((c, i) => <td key={i} style={R}>{daysText(c.lead_days)}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
