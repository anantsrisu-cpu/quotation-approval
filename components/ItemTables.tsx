'use client';
import { compDiscounts, compNets, compPrices, daysText, itemsOf, netOf, normDiscount } from '@/lib/calc';
import { dOnly, fmt, fmtQty, r2 } from '@/lib/format';
import type { DeliverySlot, LineItem, RequestRow } from '@/lib/types';

/** Vendor ticked ✓ for each item (older requests: everything from the main vendor). */
export function awardsOf(r: RequestRow, items: LineItem[] = itemsOf(r)) {
  const comps = r.no_comp ? [] : r.comparisons || [];
  return items.map((it) => (it.award != null && it.award >= 0 && it.award <= comps.length ? it.award : 0));
}

const vendorOf = (r: RequestRow, v: number) => (v === 0 ? r.vendor : (r.comparisons || [])[v - 1]?.vendor || '');

/** The price a ticked line is bought at. */
function boughtLine(r: RequestRow, it: LineItem, k: number, v: number, n: number) {
  if (v === 0) {
    const net = netOf(it);
    return { vendor: r.vendor, unit: it.unit_price, disc: normDiscount(it.discount), net, line: it.line_total ?? r2(net * it.qty) };
  }
  const c = (r.comparisons || [])[v - 1];
  const net = compNets(c, n)[k];
  const line = it.award_line ?? (c.lines?.[k] != null ? Number(c.lines[k]) : r2(net * it.qty));
  return { vendor: c.vendor, unit: compPrices(c)[k] || 0, disc: compDiscounts(c, n)[k], net, line };
}

/** แบ่งซื้อ parts of an item (empty = bought from one vendor) */
export function splitOf(it: LineItem) {
  return (it.split || []).map((x) => ({ v: x.v, qty: Number(x.qty), pct: x.pct ?? r2((Number(x.qty) / (it.qty || 1)) * 100), line: x.line }));
}

/** ☑ place · ☐ place */
export function DeliveryText({ list }: { list?: DeliverySlot[] | null }) {
  const xs = (list || []).filter((x) => x.place);
  if (!xs.length) return <span className="note">—</span>;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
      {xs.map((x, i) => (
        <span key={i} style={{ whiteSpace: 'nowrap', color: x.on ? 'var(--ink)' : 'var(--muted)', fontWeight: x.on ? 600 : 400 }}>
          {x.on ? '☑' : '☐'} {x.place}
        </span>
      ))}
    </span>
  );
}

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
  const aw = awardsOf(r, items);
  const bought = items.map((it, k) => boughtLine(r, it, k, aw[k], items.length));
  const multi = !r.no_comp && (r.comparisons || []).length > 0;
  const hasDisc = bought.some((b) => b.disc);
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
            const b = bought[i];
            const net = b.net;
            const pct = aw[i] === 0 && it.prev_diff_pct != null ? it.prev_diff_pct : it.prev_price ? r2(((net - it.prev_price) / it.prev_price) * 100) : null;
            return (
              <tr key={i}>
                <td className="note">{i + 1}</td>
                <td>
                  <span className="mono" style={{ fontSize: 12 }}>{it.sku}</span> · {it.product_name || '—'}
                  {it.brand && <span className="chip st-draft" style={{ marginLeft: 6 }}>{it.brand}</span>}
                  {it.description && <div className="note" style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{it.description}</div>}
                  {it.report_no && <div className="note" style={{ color: 'var(--ink-2)' }}>รายงานเลขที่ {it.report_no}</div>}
                  {multi && (
                    <div className="note" style={{ color: 'var(--sage-ink)', fontWeight: 600 }}>
                      {splitOf(it).length
                        ? <>✓ แบ่งซื้อ: {splitOf(it).map((x) => `เจ้าที่ ${x.v + 1} ${vendorOf(r, x.v)} ${x.qty.toLocaleString('en-US')} ${it.unit} (${x.pct}%)`).join(' + ')}</>
                        : <>✓ ซื้อจาก เจ้าที่ {aw[i] + 1} {b.vendor}</>}
                      {it.award_reason && <span style={{ color: 'var(--bad)', fontWeight: 400 }}> · {splitOf(it).length ? 'เหตุผล' : 'ไม่ใช่ราคาต่ำสุด'}: {it.award_reason}</span>}
                    </div>
                  )}
                </td>
                <td className="num" style={{ ...R, whiteSpace: 'nowrap' }}>{fmtQty(it.qty)} {it.unit}</td>
                <td className="num" style={R}>{splitOf(it).length ? <span className="note">แบ่งซื้อ</span> : fmt(b.unit)}</td>
                {hasDisc && <td className="num" style={R}>{splitOf(it).length ? '—' : b.disc || '—'}</td>}
                {hasDisc && <td className="num" style={R}><b>{fmt(net)}</b></td>}
                <td className="num" style={R}>
                  {it.prev_price != null ? fmt(it.prev_price) : <span className="note">—</span>}
                  {(it.prev_vendor || it.prev_date) && <div className="note" style={{ whiteSpace: 'normal' }}>{[it.prev_vendor, it.prev_date ? dOnly(it.prev_date) : ''].filter(Boolean).join(' · ')}</div>}
                </td>
                <td style={R}><PrevPct pct={pct} /></td>
                <td className="num" style={R}>{fmt(splitOf(it).length ? it.award_line ?? b.line : b.line)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr><td colSpan={span} style={R}>{multi ? 'ยอดที่ขออนุมัติ ก่อน VAT (ตาม ✓) · Subtotal' : 'มูลค่ารวม ก่อน VAT · Subtotal'}</td><td className="num" style={R}>{fmt(r.subtotal)}</td></tr>
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
  const aw = awardsOf(r, items);
  const rate = r.vat_rate || 0.07;
  const line1 = items.map((it) => it.line_total ?? r2(netOf(it) * it.qty));
  const sub1 = r2(line1.reduce((s, x) => s + x, 0));
  const lineOf = (v: number, k: number) => (v === 0 ? line1[k] : boughtLine(r, items[k], k, v, n).line);
  const partOf = (k: number, v: number) => splitOf(items[k]).find((x) => x.v === v);
  const isWon = (k: number, v: number) => (splitOf(items[k]).length ? !!partOf(k, v) : aw[k] === v);
  const byVendor = [0, ...comps.map((_, i) => i + 1)].map((v) =>
    r2(items.reduce((s, it, k) => {
      const sp = splitOf(it);
      if (sp.length) return s + sp.filter((x) => x.v === v).reduce((t, x) => t + (x.line ?? r2(compNetAt(v, k) * x.qty)), 0);
      return s + (aw[k] === v ? lineOf(v, k) : 0);
    }, 0)));
  function compNetAt(v: number, k: number) {
    return v === 0 ? netOf(items[k]) : compNets(comps[v - 1], n)[k];
  }
  const cell = (price: number, disc: string, net: number, line: number, won: boolean, k: number, v: number) => {
    const part = partOf(k, v);
    return (
      <>
        {!(price > 0) ? <span className="note">ไม่ได้เสนอ</span> : disc ? <><span className="note">{fmt(price)} ลด {disc}</span><br /><b>{fmt(net)}</b></> : fmt(price)}
        {price > 0 && <div className="note">= {fmt(line)}</div>}
        {won && <div style={{ color: 'var(--sage-ink)', fontWeight: 700 }}>{part ? `✓ แบ่งซื้อ ${part.qty.toLocaleString('en-US')} (${part.pct}%)` : '✓ สั่งซื้อ'}</div>}
      </>
    );
  };
  return (
    <div className="tw">
      <table className="t cmp" style={{ minWidth: 420 + comps.length * 130 }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}>#</th>
            <th>สินค้า · Item</th>
            <th style={R}>จำนวน</th>
            <th className="sel" style={R}>เจ้าที่ 1 · {r.vendor}</th>
            {comps.map((c, i) => <th key={i} style={R}>เจ้าที่ {i + 2} · {c.vendor}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((it, k) => (
            <tr key={k}>
              <td className="note">{k + 1}</td>
              <td>
                <span className="mono" style={{ fontSize: 12 }}>{it.sku}</span> · {it.product_name}
                {it.award_reason && <div className="note" style={{ color: 'var(--bad)' }}>{splitOf(it).length ? 'แบ่งซื้อ เหตุผล' : 'ไม่ใช่ราคาต่ำสุด'}: {it.award_reason}</div>}
              </td>
              <td className="num" style={{ ...R, whiteSpace: 'nowrap' }}>{fmtQty(it.qty)} {it.unit}</td>
              <td className={`num sel${isWon(k, 0) ? ' won' : ''}`} style={R}>{cell(it.unit_price, normDiscount(it.discount), netOf(it), line1[k], isWon(k, 0), k, 0)}</td>
              {comps.map((c, i) => (
                <td key={i} className={`num${isWon(k, i + 1) ? ' won' : ''}`} style={R}>
                  {cell(compPrices(c)[k] || 0, compDiscounts(c, n)[k], compNets(c, n)[k], lineOf(i + 1, k), isWon(k, i + 1), k, i + 1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>มูลค่ารวม ก่อน VAT · Subtotal</td>
            <td className="num sel" style={R}>{fmt(sub1)}</td>
            {comps.map((c, i) => <td key={i} className="num" style={R}>{c.subtotal != null ? fmt(c.subtotal) : '—'}</td>)}
          </tr>
          <tr>
            <td colSpan={3}><b>รวม VAT · Total</b></td>
            <td className="num sel" style={R}><b>{fmt(r2(sub1 + r2(sub1 * rate)))}</b></td>
            {comps.map((c, i) => <td key={i} className="num" style={R}><b>{c.total != null ? fmt(c.total) : '—'}</b></td>)}
          </tr>
          <tr>
            <td colSpan={3}><b>สั่งซื้อตาม ✓ (ก่อน VAT)</b></td>
            {byVendor.map((v, i) => (
              <td key={i} className={`num${i === 0 ? ' sel' : ''}`} style={{ ...R, fontWeight: 600, color: v > 0 ? 'var(--sage-ink)' : 'var(--muted)' }}>{v > 0 ? `✓ ${fmt(v)}` : '—'}</td>
            ))}
          </tr>
          <tr>
            <td colSpan={3}>ส่วนต่าง · Difference</td>
            <td className="sel" style={R}>เทียบกับเจ้าที่ 1</td>
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
          <tr>
            <td colSpan={3}>สถานที่จัดส่งสินค้า · Delivery</td>
            <td className="sel" style={R}><DeliveryText list={r.delivery} /></td>
            {comps.map((c, i) => <td key={i} style={R}><DeliveryText list={c.delivery} /></td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
