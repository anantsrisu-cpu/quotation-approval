import { num, r2 } from './format';
import type { Comparison, LineItem, RequestRow } from './types';

/** Line item as typed on the form (strings so half-typed numbers stay editable). */
export interface DraftItem {
  sku: string;
  description: string;
  qty: string;
  unit: string;
  unit_price: string;
  prev_price: string;
}
/** Comparison vendor as typed: one unit price per line item, same order as the items. */
export interface DraftComp {
  vendor: string;
  prices: string[];
}

export const blankItem = (unit = 'ชิ้น'): DraftItem => ({ sku: '', description: '', qty: '1', unit, unit_price: '', prev_price: '' });

/** % change of the new unit price against the previous price (null when there is no previous price). */
export const prevPct = (up: number, prev: number | null | undefined) =>
  prev != null && prev > 0 ? r2(((up - prev) / prev) * 100) : null;

/** Same arithmetic the database uses in submit_request (shown live on the form). */
export function calcItems(items: DraftItem[], vatRate: number, comps: DraftComp[]) {
  const lines = items.map((it) => {
    const up = num(it.unit_price);
    const q = num(it.qty);
    const prev = it.prev_price.trim() === '' ? null : num(it.prev_price);
    return { up, q, line: r2(up * q), prev, pct: prevPct(up, prev) };
  });
  const sub = r2(lines.reduce((s, l) => s + l.line, 0));
  const vat = r2(sub * vatRate);
  const total = r2(sub + vat);
  const cs = comps.map((c) => {
    const cl = lines.map((l, k) => {
      const p = num(c.prices[k]);
      return { up: p, line: r2(p * l.q) };
    });
    const csub = r2(cl.reduce((s, x) => s + x.line, 0));
    const ctot = r2(csub + r2(csub * vatRate));
    const complete = cl.length > 0 && cl.every((x) => x.up > 0);
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

/** A comparison vendor's unit prices, one per item (older requests stored a single unit_price). */
export function compPrices(c: Comparison): number[] {
  if (Array.isArray(c.prices)) return c.prices.map((x) => num(x));
  return c.unit_price != null ? [num(c.unit_price)] : [];
}
