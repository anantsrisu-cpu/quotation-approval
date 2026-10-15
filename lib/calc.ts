import { num, r2 } from './format';
import type { Comparison, LineItem, RequestRow } from './types';

/** Line item as typed on the form (strings so half-typed numbers stay editable). */
export interface DraftItem {
  sku: string;
  description: string;
  qty: string;
  unit: string;
  unit_price: string;
  discount: string;
  prev_price: string;
}
/** Comparison vendor as typed: one unit price and discount per line item, same order as the items. */
export interface DraftComp {
  vendor: string;
  prices: string[];
  discounts: string[];
  credit_days: string;
  lead_days: string;
}

export const blankItem = (unit = 'ชิ้น'): DraftItem => ({ sku: '', description: '', qty: '1', unit, unit_price: '', discount: '', prev_price: '' });
export const blankComp = (n: number): DraftComp => ({ vendor: '', prices: Array(n).fill(''), discounts: Array(n).fill(''), credit_days: '', lead_days: '' });

/** % change of the new (net) unit price against the previous price (null when there is no previous price). */
export const prevPct = (up: number, prev: number | null | undefined) =>
  prev != null && prev > 0 ? r2(((up - prev) / prev) * 100) : null;

export const normDiscount = (d: string | null | undefined) => String(d ?? '').replace(/[\s,]/g, '');
const DISC_RE = /^[0-9]+(\.[0-9]+)?%?(\+[0-9]+(\.[0-9]+)?%?)*$/;

/**
 * Net unit price after a discount — same rule as apply_discount() in the database.
 * "5%" = 5 percent · "100" = 100 baht per unit · "10%+5%" = 10% then another 5%.
 */
export function applyDiscount(price: number, disc: string | null | undefined): { net: number; error: string | null } {
  const d = normDiscount(disc);
  if (!d) return { net: r2(price), error: null };
  if (!DISC_RE.test(d)) return { net: r2(price), error: 'รูปแบบส่วนลดไม่ถูกต้อง ใช้ 5% หรือ 100 หรือ 10%+5%' };
  let net = price;
  for (const part of d.split('+')) {
    if (part.endsWith('%')) {
      const v = parseFloat(part);
      if (v > 100) return { net: r2(price), error: 'ส่วนลดเกิน 100%' };
      net = (net * (100 - v)) / 100;
    } else net -= parseFloat(part);
  }
  net = r2(net);
  if (price > 0 && net <= 0) return { net: 0, error: 'ราคาหลังหักส่วนลดต้องมากกว่า 0' };
  return { net, error: null };
}

/** Whole days 0–3650 as typed ('' = not given). */
export function parseDays(v: string): { days: number | null; error: string | null } {
  const t = v.trim();
  if (!t) return { days: null, error: null };
  if (!/^\d{1,4}$/.test(t) || +t > 3650) return { days: null, error: 'ใส่จำนวนวันเป็นตัวเลข 0–3650' };
  return { days: +t, error: null };
}

/** Same arithmetic the database uses in submit_request (shown live on the form). */
export function calcItems(items: DraftItem[], vatRate: number, comps: DraftComp[]) {
  const lines = items.map((it) => {
    const up = num(it.unit_price);
    const q = num(it.qty);
    const { net, error } = applyDiscount(up, it.discount);
    const prev = it.prev_price.trim() === '' ? null : num(it.prev_price);
    return { up, q, net, discErr: error, hasDisc: !!normDiscount(it.discount), line: r2(net * q), prev, pct: prevPct(net, prev) };
  });
  const sub = r2(lines.reduce((s, l) => s + l.line, 0));
  const vat = r2(sub * vatRate);
  const total = r2(sub + vat);
  const cs = comps.map((c) => {
    const cl = lines.map((l, k) => {
      const p = num(c.prices[k]);
      const { net, error } = applyDiscount(p, c.discounts[k]);
      return { up: p, net, discErr: error, hasDisc: !!normDiscount(c.discounts[k]), line: r2(net * l.q) };
    });
    const csub = r2(cl.reduce((s, x) => s + x.line, 0));
    const ctot = r2(csub + r2(csub * vatRate));
    const complete = cl.length > 0 && cl.every((x) => x.up > 0 && !x.discErr);
    return { vendor: c.vendor, lines: cl, sub: csub, total: ctot, diff: r2(ctot - total), complete };
  });
  const vals = cs.filter((c) => c.complete).map((c) => c.total);
  const minC = vals.length ? Math.min(...vals) : null;
  return { lines, sub, vat, total, comps: cs, minC, lowest: minC === null || total <= minC };
}

/** Line items of a request (older single-item requests are shown as one line). */
export function itemsOf(r: Pick<RequestRow, 'items' | 'sku' | 'product_name' | 'qty' | 'unit' | 'unit_price' | 'subtotal'>): LineItem[] {
  if (r.items && r.items.length) return r.items;
  if (!r.sku) return [];
  return [{ sku: r.sku, product_name: r.product_name, description: '', qty: r.qty, unit: r.unit, unit_price: r.unit_price, prev_price: null, line_total: r.subtotal || r2(r.unit_price * r.qty) }];
}

/** Unit price after discount of a stored line item. */
export const netOf = (it: LineItem) => it.net_price ?? applyDiscount(it.unit_price, it.discount).net;

/** A comparison vendor's unit prices, one per item (older requests stored a single unit_price). */
export function compPrices(c: Comparison): number[] {
  if (Array.isArray(c.prices)) return c.prices.map((x) => num(x));
  return c.unit_price != null ? [num(c.unit_price)] : [];
}
/** A comparison vendor's discount text per item. */
export const compDiscounts = (c: Comparison, n: number): string[] => Array.from({ length: n }, (_, k) => normDiscount(c.discounts?.[k]));
/** A comparison vendor's net unit price per item. */
export function compNets(c: Comparison, n: number): number[] {
  const ps = compPrices(c);
  const ds = compDiscounts(c, n);
  return Array.from({ length: n }, (_, k) => (c.nets && c.nets[k] != null ? num(c.nets[k]) : applyDiscount(ps[k] || 0, ds[k]).net));
}

/** "30 วัน" or "—" */
export const daysText = (d: number | null | undefined) => (d == null ? '—' : `${d} วัน`);
