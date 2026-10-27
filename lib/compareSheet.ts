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
  vendors: SheetVendor[]; // selected vendor first
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
.cs-sig .x{position:absolute;left:0;top:48px;width:100%;height:calc(100% - 48px);pointer-events:none;display:block}
.cs-sig.skip .b{color:#777}
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

function layoutCols(nv: number) {
  const fixed = { item: 32, part: 76, brand: 58, qty: 38, unit: 40, prev: 84 };
  const fixedSum = Object.values(fixed).reduce((a, b) => a + b, 0);
  const minDesc = nv > 5 ? 110 : 150;
  const vw = Math.max(44, Math.min(88, Math.floor((INNER_W - fixedSum - minDesc) / (2 * Math.max(1, nv)))));
  const desc = INNER_W - fixedSum - vw * 2 * nv;
  const font = nv <= 3 ? 10 : nv <= 5 ? 9.5 : 8.5;
  return { ...fixed, desc, vw, font };
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
  return `<colgroup><col style="width:${L.item}px"><col style="width:${L.part}px"><col style="width:${L.desc}px"><col style="width:${L.brand}px"><col style="width:${L.qty}px"><col style="width:${L.unit}px"><col style="width:${L.prev}px">${Array(nv * 2)
    .fill(`<col style="width:${L.vw}px">`)
    .join('')}</colgroup>`;
}

function theadHtml(d: SheetData) {
  const nv = d.vendors.length;
  return `<thead>
<tr><th rowspan="3">Item</th><th rowspan="3">Part No.</th><th rowspan="3">DESCRIPTION</th><th rowspan="3">BRAND</th><th rowspan="3">Q'TY</th><th rowspan="3">UNIT</th>
<th rowspan="3">ราคาประวัติเก่า /<br>ชื่อบริษัท / เมื่อไร<br>(ต่อหน่วย)</th><th colspan="${nv * 2}">Vendor Name</th></tr>
<tr>${d.vendors
    .map(
      (v, i) =>
        `<th colspan="2"${v.selected ? ' class="sel"' : ''}>เจ้าที่ ${i + 1}${v.selected ? ' ✓ ที่เลือก' : ''}<br><b style="font-weight:600">${esc(v.name)}</b></th>`,
    )
    .join('')}</tr>
<tr>${d.vendors.map((v) => `<th${v.selected ? ' class="sel"' : ''}>ราคาต่อหน่วย</th><th${v.selected ? ' class="sel"' : ''}>ราคารวม</th>`).join('')}</tr>
</thead>`;
}

function rowHtml(d: SheetData, k: number) {
  const it = d.items[k];
  const prev =
    it.prevPrice != null
      ? `${money(it.prevPrice)}${it.prevVendor || it.prevDate ? `<span class="sub">${esc(it.prevVendor || '')}${it.prevVendor && it.prevDate ? ' / ' : ''}${esc(dmy(it.prevDate))}</span>` : ''}`
      : '';
  return `<tr data-k="${k}"><td class="c">${k + 1}</td><td>${esc(it.sku)}</td><td>${esc(it.name)}${it.description ? `<div class="desc">${esc(it.description)}</div>` : ''}</td>
<td>${esc(it.brand || '')}</td><td class="n">${qtyFmt(it.qty)}</td><td class="c">${esc(it.unit)}</td><td class="n" style="white-space:normal;text-align:right">${prev}</td>
${d.vendors
  .map((v) => {
    const cls = v.selected ? ' sel' : '';
    const disc = v.disc[k];
    return `<td class="n${cls}">${money(v.net[k])}${disc ? `<span class="sub">${money(v.unit[k])} ลด ${esc(disc)}</span>` : ''}</td><td class="n${cls}">${money(v.line[k])}</td>`;
  })
  .join('')}</tr>`;
}

function tfootHtml(d: SheetData) {
  const vatPct = Math.round(d.vatRate * 100);
  const money3 = (label: string, pick: (v: SheetVendor) => number, first: boolean) =>
    `<tr>${first ? '<td colspan="4" rowspan="6" class="blank"></td>' : ''}<td colspan="2" class="lbl">${label}</td><td></td>${d.vendors
      .map((v) => `<td></td><td class="n">${money(pick(v))}</td>`)
      .join('')}</tr>`;
  const text3 = (label: string, pick: (v: SheetVendor) => string) =>
    `<tr><td colspan="2" class="lbl">${label}</td><td></td>${d.vendors.map((v) => `<td colspan="2" class="c">${esc(pick(v))}</td>`).join('')}</tr>`;
  return `<tbody class="cs-foot">
${money3('TOTAL', (v) => v.subtotal, true)}
${money3(`VAT ${vatPct}%`, (v) => v.vat, false)}
${money3('GRAND TOTAL', (v) => v.total, false)}
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
<div class="b">${s.signature ? `<img src="${esc(s.signature)}" alt="ลายเซ็น">` : '<span class="ph"></span>'}<span>(${esc(s.name || '..........................')})</span>
<span>${esc(s.position)}</span>${s.note ? `<span style="font-size:.9em">${esc(s.note)}</span>` : ''}${s.state === 'skip' ? '<span style="font-size:.9em">ไม่ต้องลงนามในวงเงินนี้</span>' : `<span>วันที่ ${esc(s.date || '____________')}</span>`}</div>${
      s.state === 'skip'
        ? '<canvas class="x" aria-hidden="true"></canvas>'
        : ''
    }</div>`,
  )
  .join('')}</div>`;
}

function mainTable(d: SheetData, L: ReturnType<typeof layoutCols>, rows: number[], withFoot: boolean, fillH: number) {
  const nv = d.vendors.length;
  const cols = 7 + nv * 2;
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
  const L = layoutCols(d.vendors.length);

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
  // cross out the boxes of approvers not needed for this amount (drawn on a canvas so the PDF matches the screen)
  host.querySelectorAll<HTMLCanvasElement>('.cs-sig.skip canvas.x').forEach((c) => {
    const w = c.offsetWidth;
    const h = c.offsetHeight;
    c.width = w * 2;
    c.height = h * 2;
    const g = c.getContext('2d');
    if (!g) return;
    g.scale(2, 2);
    g.strokeStyle = '#111';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, h);
    g.moveTo(w, 0);
    g.lineTo(0, h);
    g.stroke();
  });
  return total;
}
