import { num, r2 } from './format';

export interface DraftComp { vendor: string; unit_price: string }

/** Same arithmetic the database uses in submit_request (shown live on the form). */
export function calcAmounts(unitPrice: string | number, qty: string | number, vatRate: number, comps: DraftComp[]) {
  const up = num(unitPrice);
  const q = num(qty);
  const sub = r2(up * q);
  const vat = r2(sub * vatRate);
  const total = r2(sub + vat);
  const cs = comps.map((c) => {
    const cu = num(c.unit_price);
    const csub = r2(cu * q);
    const ctot = r2(csub + r2(csub * vatRate));
    return { vendor: c.vendor, up: cu, sub: csub, total: ctot, diff: r2(ctot - total) };
  });
  const vals = cs.filter((c) => c.up > 0).map((c) => c.total);
  const minC = vals.length ? Math.min(...vals) : null;
  return { up, q, sub, vat, total, comps: cs, minC, lowest: minC === null || total <= minC };
}
