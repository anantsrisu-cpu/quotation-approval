/**
 * ตารางการเปรียบเทียบของราคาสินค้า · Comparison of product price table
 *
 * Landscape A4 sheet (1123 × 794 CSS px) attached after the approval letter.
 * Framework-free on purpose: the app (React) and the stand-alone trial page
 * both call renderSheet(), so what people test is what the PDF prints.
 *
 * Long item lists continue on the next sheet: the header block and the column
 * headings repeat; totals, warranty / lead time / payment term, remarks and
 * signatures come at the end of the last sheet.
 */

export interface SheetItem {
  sku: string;
  name: string;
  description?: string;
  brand?: string;
  qty: number;
  unit: string;
  prevPrice?: number | null;
  prevVendor?: string;
  prevDate?: string | null; // yyyy-mm-dd
  reportNo?: string; // printed after the description
  /** vendor ticked ✓ for this item (index into vendors) */
  award?: number | null;
  /** แบ่งซื้อ: quantity bought from each vendor (v = index into vendors) */
  split?: { v: number; qty: number; pct: number; line: number }[] | null;
}
export interface SheetVendor {
  name: string;
  selected?: boolean;
  unit: number[]; // unit price before discount, per item
  disc: string[]; // discount text per item ("" = none)
  net: number[]; // unit price after discount, per item
  line: number[]; // net × qty, per item
  subtotal: number;
  vat: number;
  total: number;
  warranty?: string;
  leadDays?: number | null;
  creditDays?: number | null;
  /** the vendor's two delivery boxes: ☑/☐ + place */
  delivery?: { place: string; on: boolean }[];
  /** amount of the ✓ lines bought from this vendor, before VAT */
  awarded?: number;
}
export interface SheetSigner {
  heading: string; // ผู้อนุมัติ (1) / ผู้จัดทำ
  range?: string; // (มูลค่า 1 - 1,000,000 บาท)
  caption: string; // Approved by / Prepared by
  name: string;
  position: string;
  date: string;
  signature?: string | null;
  note?: string; // อนุมัติแทน … / จัดทำแทนโดย …
  /** skip = not needed for this amount (crossed out) · wet = signs by hand on the printout */
  state?: 'skip' | 'wet';
}
export interface SheetData {
  logoUrl?: string | null;
  initials: string;
  companies: { id: string; label: string }[];
  companyId: string | null;
  info: [string, string][]; // right-hand header lines
  rev: number;
  items: SheetItem[];
  vendors: SheetVendor[]; // เจ้าที่ 1 (the main quotation) first
  vatRate: number;
  notes: string[];
  signers: SheetSigner[]; // left → right as printed
  draft?: boolean;
}

export const SHEET_W = 1123;
export const SHEET_H = 794;
const PAD_X = 24;
const PAD_Y = 22;
const INNER_W = SHEET_W - PAD_X * 2;

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const money = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
const dmy = (s?: string | null) => {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};
const days = (d?: number | null) => (d == null ? '' : `${d} วัน`);

const CSS = `
.cs-page{position:relative;width:${SHEET_W}px;height:${SHEET_H}px;box-sizing:border-box;padding:${PAD_Y}px ${PAD_X}px;background:#fff;color:#111;
  font-family:'Sarabun','IBM Plex Sans Thai',Tahoma,sans-serif;font-size:10px;line-height:1.3;overflow:hidden;flex:none;margin:0 auto}
.cs-page *{box-sizing:border-box}
.cs-page table{border-collapse:collapse;width:100%;table-layout:fixed}
.cs-page td,.cs-page th{border:1px solid #333;padding:2px 4px;vertical-align:middle;overflow-wrap:anywhere}
.cs-page th{font-weight:400}
.cs-head td{vertical-align:top}
.cs-logo{display:flex;align-items:center;justify-content:center;height:100%}
.cs-logo img{max-width:150px;max-height:74px;object-fit:contain;display:block}
.cs-logo .ini{width:64px;height:64px;border-radius:12px;background:#502D1E;color:#fff;font-weight:700;font-size:22px;display:grid;place-items:center}
.cs-cos{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 28px;font-weight:700;font-size:11px}
.cs-box{display:inline-block;width:11px;height:11px;border:1.2px solid #111;margin-right:5px;vertical-align:-1px;text-align:center;line-height:9px;font-size:10px}
.cs-title{text-align:center;margin-top:8px;font-size:13px;line-height:1.35}
.cs-info{font-size:10px;line-height:1.55}
.cs-info b{font-weight:600}
.cs-rev{text-align:center}
.cs-main th{font-size:9.5px;text-align:center;line-height:1.2}
.cs-main td.n,.cs-main th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.cs-main td.c{text-align:center}
.cs-main tbody td{vertical-align:top}
.cs-main .sel{background:#FBF6EF}
.cs-main td.won{background:#EAF3E6;font-weight:600}
.cs-main td.na{color:#888;font-size:.9em;text-align:center}
.cs-main td.won .sub.sp{color:#1E6B2E;font-weight:600}
.cs-main .tk{float:left;font-weight:700;color:#1E6B2E;font-size:1.15em;line-height:1}
.cs-foot td.dl{font-size:.92em;background:#fff;white-space:normal;line-height:1.25}
.cs-foot td.dl .cs-box{width:10px;height:10px;line-height:8px;font-size:9px;margin-right:3px}
.cs-foot tr.aw td{background:#EAF3E6}
.cs-main .sub{display:block;font-size:.82em;color:#555;white-space:normal}
.cs-main .desc{white-space:pre-wrap;font-size:.9em;color:#333}
.cs-main tr.fill td{border-top:none}
.cs-foot td{background:#FFFBE3}
.cs-foot td.lbl{text-align:center;font-size:9.5px;font-weight:600}
.cs-foot td.blank{background:#fff}
.cs-bottom{display:flex;border:1px solid #333;border-top:none}
.cs-notes{flex:1 1 220px;min-width:200px;padding:3px 6px;font-size:9.5px}
.cs-notes u{font-weight:600}
.cs-notes .ln{border-bottom:1px solid #bbb;min-height:15px;padding-top:2px;white-space:pre-wrap}
.cs-sig{flex:0 1 168px;min-width:0;border-left:1px solid #333;display:flex;flex-direction:column;text-align:center;font-size:9.5px;position:relative}
.cs-sig .x{display:block;width:130px;height:34px}
.cs-sig .wet{color:#555;font-size:.92em}
.cs-sig .h{border-bottom:1px solid #333;padding:3px 2px;height:48px;overflow:hidden;line-height:1.3;font-size:9px}
.cs-sig .h b{font-weight:600}
.cs-sig .b{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding:2px 4px 4px;gap:1px}
.cs-sig img{height:34px;max-width:130px;object-fit:contain}
.cs-sig .ph{height:34px;display:grid;place-items:center;color:#999}
.cs-wm{position:absolute;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-18deg);font-size:120px;font-weight:700;color:rgba(172,137,121,.14);white-space:nowrap;pointer-events:none}
`;

function ensureStyle(doc: Document) {
  if (doc.getElementById('cs-style')) return;
  const st = doc.createElement('style');
  st.id = 'cs-style';
  st.textContent = CSS;
  doc.head.appendChild(st);
}

/** แบ่งซื้อ on any item: every vendor gets its own Q'TY column */
const hasSplit = (d: SheetData) => d.items.some((it) => it.split && it.split.length);
/** columns per vendor: [Q'TY,] ราคาต่อหน่วย, ราคารวม */
const perVendor = (d: SheetData) => (hasSplit(d) ? 3 : 2);

/**
 * Column widths. Q'TY, unit-price and total columns are as wide as their longest
 * number (e.g. 2,459,600 or ✓ 47,403,200.00) so nothing spills into the next column;
 * DESCRIPTION gives up width first, then the font gets a little smaller.
 */
function layoutCols(d: SheetData) {
  const nv = Math.max(1, d.vendors.length);
  const per = perVendor(d);
  const len = (xs: string[]) => Math.max(1, ...xs.map((x) => x.length));
  const qLen = len(d.items.map((it) => qtyFmt(it.qty)));
  const uLen = len(d.vendors.flatMap((v) => v.net.map((x) => money(x))));
  const lLen = len(d.vendors.flatMap((v) => [...v.line, v.subtotal, v.total].map((x) => money(x))));
  const base = nv <= 3 ? 10 : nv <= 5 ? 9.5 : 8.5;
  const fixedOther = 32 + 76 + 58 + 40 + 84; // item, part no., brand, unit, previous price
  let out = null as null | { item: number; part: number; brand: number; qty: number; unit: number; prev: number; desc: number; qw: number; uw: number; lw: number; font: number };
  for (let font = base; font >= 7.5; font -= 0.5) {
    const digit = font * 0.6; // one digit or comma in the sheet font, with a little slack
    const fit = (chars: number, min: number, extra = 0) => Math.round(Math.max(min, chars * digit + 10 + extra));
    const qty = fit(qLen, 38);
    const qw = per === 3 ? fit(qLen, nv > 4 ? 30 : 36) : 0;
    let uw = fit(uLen, 44);
    let lw = fit(lLen, 44, font * 1.1); // room for the ✓
    // spare room goes to the vendor columns (up to 88 px each), the rest to DESCRIPTION
    const minDesc = nv > 5 ? 110 : per === 3 ? 120 : 150;
    const spare = INNER_W - fixedOther - qty - minDesc - (qw + uw + lw) * nv;
    if (spare < 0 && font > 7.5) continue;
    const grow = Math.max(0, Math.min(Math.floor(spare / (2 * nv)), 88 - Math.min(uw, lw)));
    uw += Math.max(0, Math.min(grow, 88 - uw));
    lw += Math.max(0, Math.min(grow, 88 - lw));
    const desc = INNER_W - fixedOther - qty - (qw + uw + lw) * nv;
    out = { item: 32, part: 76, brand: 58, qty, unit: 40, prev: 84, desc: Math.max(80, desc), qw, uw, lw, font };
    break;
  }
  return out!;
}

function headerHtml(d: SheetData, page: number, pages: number) {
  const cos = d.companies.length ? d.companies : [{ id: d.companyId || '', label: '' }];
  return `<table class="cs-head"><colgroup><col style="width:170px"><col><col style="width:250px"><col style="width:72px"><col style="width:72px"></colgroup>
<tr>
<td rowspan="2"><div class="cs-logo">${d.logoUrl ? `<img src="${esc(d.logoUrl)}" alt="" crossorigin="anonymous">` : `<div class="ini">${esc(d.initials || 'CO')}</div>`}</div></td>
<td rowspan="2"><div class="cs-cos">${cos
    .map((c) => `<span><span class="cs-box">${c.id === d.companyId ? '✓' : ''}</span>${esc(c.label)}</span>`)
    .join('')}</div>
<div class="cs-title">ตารางการเปรียบเทียบของราคาสินค้า<br>COMPARISON OF PRODUCT PRICE TABLE</div></td>
<td rowspan="2" class="cs-info">${d.info.map(([k, v]) => `${esc(k)} : <b>${esc(v)}</b>`).join('<br>')}</td>
<td class="cs-rev" style="height:16px">Rev.</td><td class="cs-rev">Page</td></tr>
<tr><td class="cs-rev"><svg width="44" height="38" viewBox="0 0 44 38" aria-label="Rev ${d.rev}"><path d="M22 2 L42 36 L2 36 Z" fill="none" stroke="#111" stroke-width="1.2"/><text x="22" y="31" text-anchor="middle" font-size="12" font-family="sans-serif">${d.rev}</text></svg></td>
<td class="cs-rev" style="vertical-align:middle;font-size:13px">${page}/${pages}</td></tr></table>`;
}

function colgroup(L: ReturnType<typeof layoutCols>, nv: number) {
  const one = (L.qw ? `<col style="width:${L.qw}px">` : '') + `<col style="width:${L.uw}px"><col style="width:${L.lw}px">`;
  return `<colgroup><col style="width:${L.item}px"><col style="width:${L.part}px"><col style="width:${L.desc}px"><col style="width:${L.brand}px"><col style="width:${L.qty}px"><col style="width:${L.unit}px"><col style="width:${L.prev}px">${one.repeat(nv)}</colgroup>`;
}

function theadHtml(d: SheetData) {
  const nv = d.vendors.length;
  const per = perVendor(d);
  return `<thead>
<tr><th rowspan="3">Item</th><th rowspan="3">Part No.</th><th rowspan="3">DESCRIPTION</th><th rowspan="3">BRAND</th><th rowspan="3">Q'TY</th><th rowspan="3">UNIT</th>
<th rowspan="3">ราคาประวัติเก่า /<br>ชื่อบริษัท / เมื่อไร<br>(ต่อหน่วย)</th><th colspan="${nv * per}">Vendor Name</th></tr>
<tr>${d.vendors
    .map(
      (v, i) =>
        `<th colspan="${per}"${v.selected ? ' class="sel"' : ''}>เจ้าที่ ${i + 1}${v.selected ? ' ✓' : ''}<br><b style="font-weight:600">${esc(v.name)}</b></th>`,
    )
    .join('')}</tr>
<tr>${d.vendors.map((v) => `${per === 3 ? `<th${v.selected ? ' class="sel"' : ''}>Q'TY</th>` : ''}<th${v.selected ? ' class="sel"' : ''}>ราคาต่อหน่วย</th><th${v.selected ? ' class="sel"' : ''}>ราคารวม</th>`).join('')}</tr>
</thead>`;
}

function rowHtml(d: SheetData, k: number) {
  const it = d.items[k];
  const prev =
    it.prevPrice != null
      ? `${money(it.prevPrice)}${it.prevVendor || it.prevDate ? `<span class="sub">${esc(it.prevVendor || '')}${it.prevVendor && it.prevDate ? ' / ' : ''}${esc(dmy(it.prevDate))}</span>` : ''}`
      : '';
  return `<tr data-k="${k}"><td class="c">${k + 1}</td><td>${esc(it.sku)}</td><td>${esc(it.name)}${it.description ? `<div class="desc">${esc(it.description)}</div>` : ''}${it.reportNo ? `<div class="desc">เลขที่ใบขอซื้อ ${esc(it.reportNo)}</div>` : ''}</td>
<td>${esc(it.brand || '')}</td><td class="n">${qtyFmt(it.qty)}</td><td class="c">${esc(it.unit)}</td><td class="n" style="white-space:normal;text-align:right">${prev}</td>
${d.vendors
  .map((v, vi) => {
    const disc = v.disc[k];
    const part = it.split?.find((x) => x.v === vi);
    const won = it.split ? !!part : it.award === vi;
    const split3 = perVendor(d) === 3;
    const share = part ? (split3 ? `<span class="sub sp">แบ่งซื้อ ${part.pct}%<br>= ${money(part.line)}</span>` : `<span class="sub sp">แบ่งซื้อ ${qtyFmt(part.qty)} ${esc(it.unit)} (${part.pct}%)<br>= ${money(part.line)}</span>`) : '';
    // Q'TY bought from this vendor: the split part, or the whole quantity where this vendor has the ✓
    const q = part ? part.qty : !it.split && won ? it.qty : null;
    const qcell = split3 ? `<td class="n${q != null ? ' won' : ''}">${q != null ? qtyFmt(q) : ''}</td>` : '';
    // ซื้อหลายเจ้า: this vendor did not quote the item
    if (!(v.unit[k] > 0)) return `${qcell}<td class="n na">ไม่ได้เสนอ</td><td class="n na">-</td>`;
    return `${qcell}<td class="n">${money(v.net[k])}${disc ? `<span class="sub">${money(v.unit[k])} ลด ${esc(disc)}</span>` : ''}</td><td class="n${won ? ' won' : ''}">${won ? '<span class="tk" aria-label="สั่งซื้อ">✓</span>' : ''}${money(v.line[k])}${share}</td>`;
  })
  .join('')}</tr>`;
}

function tfootHtml(d: SheetData) {
  const vatPct = Math.round(d.vatRate * 100);
  // the ✓ row only matters when there is more than one vendor to buy from
  const showAw = d.vendors.length > 1;
  const rows = 7 + (showAw ? 1 : 0);
  let first = true;
  const lead = () => {
    if (!first) return '';
    first = false;
    return `<td colspan="4" rowspan="${rows}" class="blank"></td>`;
  };
  const per = perVendor(d);
  const money3 = (label: string, pick: (v: SheetVendor) => number) =>
    `<tr>${lead()}<td colspan="2" class="lbl">${label}</td><td></td>${d.vendors
      .map((v) => `<td${per === 3 ? ' colspan="2"' : ''}></td><td class="n">${money(pick(v))}</td>`)
      .join('')}</tr>`;
  const text3 = (label: string, pick: (v: SheetVendor) => string) =>
    `<tr>${lead()}<td colspan="2" class="lbl">${label}</td><td></td>${d.vendors.map((v) => `<td colspan="${per}" class="c">${esc(pick(v))}</td>`).join('')}</tr>`;
  const slot = (s: { place: string; on: boolean } | undefined, span = 1) =>
    `<td class="dl"${span > 1 ? ` colspan="${span}"` : ''}>${s && s.place ? `<span class="cs-box">${s.on ? '✓' : ''}</span>${esc(s.place)}` : ''}</td>`;
  const delivery = `<tr>${lead()}<td colspan="2" class="lbl">สถานที่จัดส่งสินค้า</td><td></td>${d.vendors
    .map((v) => slot(v.delivery?.[0], per - 1) + slot(v.delivery?.[1]))
    .join('')}</tr>`;
  const awarded = showAw
    ? `<tr class="aw">${lead()}<td colspan="2" class="lbl">สั่งซื้อตาม ✓<br>(ก่อน VAT)</td><td></td>${d.vendors
        .map((v) => `<td colspan="${per}" class="n">${v.awarded ? `✓ ${money(v.awarded)}` : '-'}</td>`)
        .join('')}</tr>`
    : '';
  return `<tbody class="cs-foot">
${delivery}
${money3('TOTAL', (v) => v.subtotal)}
${money3(`VAT ${vatPct}%`, (v) => v.vat)}
${money3('GRAND TOTAL', (v) => v.total)}
${awarded}
${text3('WARRANTY', (v) => v.warranty || '')}
${text3('LEAD-TIME', (v) => days(v.leadDays))}
${text3('PAYMENT TERM', (v) => (v.creditDays == null ? '' : v.creditDays === 0 ? 'เงินสด' : `เครดิต ${v.creditDays} วัน`))}
</tbody>`;
}

function bottomHtml(d: SheetData) {
  const notes = d.notes.filter(Boolean);
  const lines = [...notes, ...Array(Math.max(0, 4 - notes.length)).fill('')];
  return `<div class="cs-bottom"><div class="cs-notes"><u>หมายเหตุ</u>${lines.map((l) => `<div class="ln">${esc(l)}</div>`).join('')}</div>
${d.signers
  .map(
    (s) => `<div class="cs-sig${s.state === 'skip' ? ' skip' : ''}"><div class="h"><b>${esc(s.heading)}</b>${s.range ? `<br>${esc(s.range)}` : ''}<br>${esc(s.caption)}${s.state === 'wet' ? ' <span class="wet">· ลายเซ็นสด</span>' : ''}</div>
<div class="b">${s.state === 'skip' ? '<canvas class="x" role="img" aria-label="ขีดฆ่า ไม่ต้องลงนามในวงเงินนี้"></canvas>' : s.signature ? `<img src="${esc(s.signature)}" alt="ลายเซ็น">` : '<span class="ph"></span>'}<span>(${esc(s.name || '..........................')})</span>
<span>${esc(s.position)}</span>${s.note ? `<span style="font-size:.9em">${esc(s.note)}</span>` : ''}<span>วันที่ ${esc(s.date || '____________')}</span></div></div>`,
  )
  .join('')}</div>`;
}

function mainTable(d: SheetData, L: ReturnType<typeof layoutCols>, rows: number[], withFoot: boolean, fillH: number) {
  const nv = d.vendors.length;
  const cols = 7 + nv * perVendor(d);
  const fill = fillH > 2 ? `<tr class="fill" style="height:${Math.floor(fillH)}px">${'<td></td>'.repeat(cols)}</tr>` : '';
  return `<table class="cs-main" style="font-size:${L.font}px;border-top:none">${colgroup(L, nv)}${theadHtml(d)}<tbody>${rows
    .map((k) => rowHtml(d, k))
    .join('')}${fill}</tbody>${withFoot ? tfootHtml(d) : ''}</table>`;
}

/** Split rows over pages so that the totals, remarks and signatures end the last page. */
function paginate(d: SheetData, m: { head: number; thead: number; rows: number[]; foot: number; bottom: number }) {
  const cap = SHEET_H - PAD_Y * 2 - m.head - m.thead - 2;
  const pages: number[][] = [[]];
  let used = 0;
  m.rows.forEach((h, k) => {
    if (pages[pages.length - 1].length && used + h > cap) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(k);
    used += h;
  });
  const usedOf = (p: number[]) => p.reduce((s, k) => s + m.rows[k], 0);
  const tail = m.foot + m.bottom;
  // the last page needs room for the totals block; move rows forward until it fits
  const last = pages[pages.length - 1];
  if (usedOf(last) + tail > cap) {
    const moved: number[] = [];
    while (last.length > 1 && usedOf(last) + tail > cap) moved.unshift(last.pop() as number);
    if (usedOf(last) + tail > cap) {
      moved.unshift(...last.splice(0));
      if (!last.length) pages.pop();
    }
    if (moved.length || !pages.length) pages.push(moved);
  }
  return { pages, cap, usedOf, tail };
}

/**
 * Render the comparison sheet into `host` (its children are replaced by one
 * `<article class="cs-page">` per landscape page). Returns the page count.
 */
export async function renderSheet(host: HTMLElement, d: SheetData): Promise<number> {
  const doc = host.ownerDocument;
  ensureStyle(doc);
  const L = layoutCols(d);

  // 1. off-screen copy with every row, to measure heights
  const meas = doc.createElement('div');
  meas.setAttribute('aria-hidden', 'true');
  meas.style.cssText = 'position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none';
  meas.innerHTML = `<div class="cs-page" style="height:auto">${headerHtml(d, 1, 1)}${mainTable(d, L, d.items.map((_, k) => k), true, 0)}${bottomHtml(d)}</div>`;
  doc.body.appendChild(meas);
  const imgs = Array.from(meas.querySelectorAll('img'));
  await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; }))));
  if (doc.fonts?.ready) await doc.fonts.ready;
  const hOf = (el: Element | null) => (el ? el.getBoundingClientRect().height : 0);
  const pageEl = meas.firstElementChild as HTMLElement;
  const m = {
    head: hOf(pageEl.querySelector('.cs-head')),
    thead: hOf(pageEl.querySelector('.cs-main thead')),
    rows: d.items.map((_, k) => hOf(pageEl.querySelector(`.cs-main tr[data-k="${k}"]`))),
    foot: hOf(pageEl.querySelector('.cs-foot')),
    bottom: hOf(pageEl.querySelector('.cs-bottom')),
  };
  meas.remove();

  // 2. fill pages
  const { pages, cap, usedOf, tail } = paginate(d, m);
  const total = pages.length || 1;
  const list = pages.length ? pages : [[]];
  host.innerHTML = list
    .map((rows, p) => {
      const isLast = p === list.length - 1;
      const fillH = cap - usedOf(rows) - (isLast ? tail : 0);
      return `<article class="cs-page sheet" aria-label="ตารางเปรียบเทียบราคา หน้า ${p + 1}">${d.draft ? '<span class="cs-wm" aria-hidden="true">ร่าง · DRAFT</span>' : ''}${headerHtml(d, p + 1, total)}${mainTable(d, L, rows, isLast, fillH)}${isLast ? bottomHtml(d) : ''}</article>`;
    })
    .join('');
  // strike through the signature line of approvers not needed for this amount
  // (one pen-like diagonal stroke, drawn on a canvas so the PDF matches the screen)
  host.querySelectorAll<HTMLCanvasElement>('.cs-sig.skip canvas.x').forEach((c) => {
    const w = c.offsetWidth;
    const h = c.offsetHeight;
    c.width = w * 2;
    c.height = h * 2;
    const g = c.getContext('2d');
    if (!g) return;
    g.scale(2, 2);
    g.strokeStyle = '#5B2BD0';
    g.lineWidth = 3.5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(5, h - 5);
    g.lineTo(w - 5, h - 23);
    g.stroke();
  });
  return total;
}
