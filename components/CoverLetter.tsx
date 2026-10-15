'use client';
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { compPrices, itemsOf, prevPct } from '@/lib/calc';
import { PURP, SUBJ, bahtText, dOnly, enDate, fmt, fmtQty, thDate, verifyCode } from '@/lib/format';
import type { RequestRow, RequestStep } from '@/lib/types';

/** One line of text that never wraps: shrinks its font (down to 7px) until it fits the column. */
function FitLine({ children, size, weight = 400, color }: { children: React.ReactNode; size: number; weight?: number; color?: string }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const d = el.current;
    if (!d) return;
    const fit = () => {
      let s = size;
      d.style.fontSize = s + 'px';
      while (d.scrollWidth > d.clientWidth + 0.5 && s > 7) {
        s = Math.max(7, s - 0.25);
        d.style.fontSize = s + 'px';
      }
    };
    fit();
    document.fonts?.ready.then(fit); // re-measure once the Thai web font has loaded
  }, [children, size]);
  return (
    <div ref={el} style={{ fontSize: size, fontWeight: weight, color, whiteSpace: 'nowrap', overflow: 'hidden' }}>
      {children}
    </div>
  );
}

/** Logo scaled up or down to fill a 265×110 px box (70 × 29 mm on A4) without distortion. */
const LOGO_MAX_W = 265;
const LOGO_MAX_H = 110;
function LetterLogo({ src }: { src: string }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <img
      src={src}
      alt=""
      crossOrigin="anonymous"
      onLoad={(e) => {
        const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget;
        if (!nw || !nh) return;
        const s = Math.min(LOGO_MAX_W / nw, LOGO_MAX_H / nh);
        setSize({ w: Math.round(nw * s), h: Math.round(nh * s) });
      }}
      style={{ display: 'block', objectFit: 'contain', width: size?.w ?? LOGO_MAX_W, height: size?.h ?? LOGO_MAX_H }}
    />
  );
}

// ---- A4 page geometry (CSS px at 96 dpi: 794 × 1123) ----
const PAGE_H = 1123;
const PAD_TOP = 34;
const PAD_BOTTOM = 30;
const GAP = 10;
const SAFETY = 6;

/** A table that may continue on the next page: its header row repeats on every page. */
interface TableSpec {
  id: string;
  cols: (number | null)[]; // px widths; null = take the rest
  head: React.ReactNode; // <tr>
  rows: { key: string; tr: React.ReactNode; stick?: boolean }[]; // stick = stays on the page of the row above
  fontSize: number;
}
type Block =
  | { kind: 'el'; key: string; node: React.ReactNode; keepWithNext?: boolean; firstPageOnly?: boolean }
  | { kind: 'table'; key: string; table: TableSpec };
type PagePart = { kind: 'el'; key: string } | { kind: 'rows'; table: string; rows: string[] };

function LTable({ t, rows }: { t: TableSpec; rows: { key: string; tr: React.ReactNode }[] }) {
  return (
    <table className="lt" data-t={t.id} style={{ fontSize: t.fontSize }}>
      <colgroup>{t.cols.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}</colgroup>
      <thead>{t.head}</thead>
      <tbody>{rows.map((r) => r.tr)}</tbody>
    </table>
  );
}

const R = { textAlign: 'right' as const };
const C = { textAlign: 'center' as const };

/**
 * หนังสืออนุมัติใบเสนอราคา — the A4 letter. The same component is used for the
 * draft preview (watermarked) and for the final PDF. Long item lists continue on
 * page 2, 3 … with the table header repeated; signatures come at the end.
 */
export const CoverLetter = forwardRef<HTMLElement, { r: RequestRow; steps: RequestStep[]; draft?: boolean }>(function CoverLetter({ r, steps, draft }, ref) {
  const { company, logoUrl, deptTh, name, people, posTh, settings } = useApp();
  const co = company(r.company_id);
  const logo = logoUrl(co);
  const prep = people[r.preparer_id];
  const subj = SUBJ[r.subject_type] || '';
  const ordered = [...steps].sort((a, b) => a.step_no - b.step_no);
  const tierShort = String(r.tier_label || '').split(' · ')[0];
  const comps = r.comparisons || [];
  const items = itemsOf(r);
  const n = items.length;
  const proxy = !!r.created_by && r.created_by !== r.preparer_id;
  const refNo = r.no ? `${r.no}/AP` : '(ยังไม่ออกเลข)';
  const hasPrev = items.some((it) => it.prev_price != null);
  const first = items[0];

  const Sig = ({ img, ph }: { img?: string | null; ph: string }) =>
    img ? <img src={img} alt="ลายเซ็น · Signature" /> : <span className="ph">{ph}</span>;

  // ---------- content blocks, in reading order ----------
  const header = (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '2px solid #111', paddingBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        {logo ? (
          <LetterLogo src={logo} />
        ) : (
          <div style={{ width: 110, height: 110, borderRadius: 16, background: 'var(--brown)', color: '#fff', fontFamily: 'var(--f-ui)', fontWeight: 700, fontSize: 36, display: 'grid', placeItems: 'center' }}>
            {co?.initials || 'CO'}
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'end', gap: 16 }}>
        <div style={{ lineHeight: 1.45, textAlign: 'left', minWidth: 0 }}>
          <FitLine size={14} weight={700}>{co?.th}</FitLine>
          <FitLine size={11.5} weight={600}>{co?.en}</FitLine>
          <FitLine size={10} color="#444">{co?.address}</FitLine>
        </div>
        <div style={{ textAlign: 'right', fontSize: 13, lineHeight: 1.5 }}>
          เลขที่ · Ref: <b>{refNo}</b><br />
          วันที่ {draft ? '[เมื่ออนุมัติครบ]' : thDate(r.completed_at || r.letter_at)}<br />
          Date: {draft ? '[on final approval]' : enDate(r.completed_at || r.letter_at)}
        </div>
      </div>
    </header>
  );

  const itemTitle = n > 1 ? `${first?.product_name || ''} และอีก ${n - 1} รายการ` : first?.product_name || r.product_name;

  // items table: # · item (SKU, name, long text) · qty · unit price · [previous · change] · amount
  const itemCols: (number | null)[] = hasPrev ? [30, null, 64, 84, 84, 58, 92] : [30, null, 70, 96, 104];
  const span = itemCols.length - 1;
  const itemsTable: TableSpec = {
    id: 'items',
    cols: itemCols,
    fontSize: 12,
    head: (
      <tr>
        <th style={C}>ที่</th>
        <th>รายการ · Description</th>
        <th style={R}>จำนวน</th>
        <th style={R}>ราคา/หน่วย<br />ก่อน VAT</th>
        {hasPrev && <th style={R}>ราคา<br />ก่อนหน้า</th>}
        {hasPrev && <th style={R}>+/− %</th>}
        <th style={R}>จำนวนเงิน<br />ก่อน VAT</th>
      </tr>
    ),
    rows: [
      ...items.map((it, i) => {
        const pct = it.prev_diff_pct ?? prevPct(it.unit_price, it.prev_price);
        return {
          key: `i${i}`,
          tr: (
            <tr key={`i${i}`} data-k={`i${i}`}>
              <td style={C}>{i + 1}</td>
              <td>
                <span style={{ fontSize: 10.5, color: '#444' }}>{it.sku}</span> {it.product_name}
                {it.description && <div style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#333' }}>{it.description}</div>}
              </td>
              <td style={R}>{fmtQty(it.qty)} {it.unit}</td>
              <td style={R}>{fmt(it.unit_price)}</td>
              {hasPrev && <td style={R}>{it.prev_price != null ? fmt(it.prev_price) : '—'}</td>}
              {hasPrev && <td style={R}>{pct == null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`}</td>}
              <td style={R}>{fmt(it.line_total ?? it.unit_price * it.qty)}</td>
            </tr>
          ),
        };
      }),
      { key: 'sub', stick: true, tr: <tr key="sub" data-k="sub"><td colSpan={span} style={R}>มูลค่ารวม ก่อน VAT · Subtotal before VAT</td><td style={R}>{fmt(r.subtotal)}</td></tr> },
      { key: 'vat', stick: true, tr: <tr key="vat" data-k="vat"><td colSpan={span} style={R}>ภาษีมูลค่าเพิ่ม {Math.round((r.vat_rate || 0.07) * 100)}% · VAT</td><td style={R}>{fmt(r.vat)}</td></tr> },
      { key: 'tot', stick: true, tr: <tr key="tot" data-k="tot" style={{ fontWeight: 700 }}><td colSpan={span} style={R}>รวมทั้งสิ้น (บาท) · Total (THB)</td><td style={R}>{fmt(r.total)}</td></tr> },
      { key: 'baht', stick: true, tr: <tr key="baht" data-k="baht"><td colSpan={span + 1} style={C}>({bahtText(r.total)})</td></tr> },
    ],
  };

  // comparison: one item → one row per vendor; several items → unit price of every vendor per item
  let cmpTable: TableSpec | null = null;
  if (!r.no_comp && comps.length) {
    if (n <= 1) {
      cmpTable = {
        id: 'cmp',
        cols: [null, 96, 70, 104, 104, 96],
        fontSize: 12,
        head: (
          <tr>
            <th>ผู้ขาย · Vendor</th><th style={R}>ราคาต่อหน่วย ก่อน VAT</th><th style={R}>จำนวน</th>
            <th style={R}>มูลค่ารวม ก่อน VAT</th><th style={R}>รวม VAT</th><th style={R}>ส่วนต่าง</th>
          </tr>
        ),
        rows: [
          { key: 'v0', tr: <tr key="v0" data-k="v0" style={{ fontWeight: 700 }}><td>{r.vendor} ✓</td><td style={R}>{fmt(first?.unit_price)}</td><td style={R}>{fmtQty(first?.qty)}</td><td style={R}>{fmt(r.subtotal)}</td><td style={R}>{fmt(r.total)}</td><td style={R}>ผู้ขายที่เลือก</td></tr> },
          ...comps.map((x, i) => ({
            key: `v${i + 1}`,
            tr: (
              <tr key={`v${i + 1}`} data-k={`v${i + 1}`}>
                <td>{x.vendor}</td><td style={R}>{fmt(compPrices(x)[0])}</td><td style={R}>{fmtQty(first?.qty)}</td>
                <td style={R}>{fmt(x.subtotal)}</td><td style={R}>{fmt(x.total)}</td>
                <td style={R}>{(x.diff || 0) >= 0 ? '+' : '−'}{fmt(Math.abs(x.diff || 0))}</td>
              </tr>
            ),
          })),
        ],
      };
    } else {
      const m = comps.length + 1;
      const vw = Math.max(64, Math.min(104, Math.floor((654 - 30 - 56 - 170) / m)));
      const fs = m > 4 ? 10.5 : 11.5;
      const diffCell = (d: number | undefined) => (d == null ? '—' : `${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))}`);
      cmpTable = {
        id: 'cmp',
        cols: [30, null, 56, ...Array(m).fill(vw)],
        fontSize: fs,
        head: (
          <tr>
            <th style={C}>ที่</th><th>รายการ · Item</th><th style={R}>จำนวน</th>
            <th style={R}>{r.vendor} ✓</th>
            {comps.map((x, i) => <th key={i} style={R}>{x.vendor}</th>)}
          </tr>
        ),
        rows: [
          ...items.map((it, k) => ({
            key: `c${k}`,
            tr: (
              <tr key={`c${k}`} data-k={`c${k}`}>
                <td style={C}>{k + 1}</td><td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.sku} {it.product_name}</td><td style={R}>{fmtQty(it.qty)}</td>
                <td style={{ ...R, fontWeight: 700 }}>{fmt(it.unit_price)}</td>
                {comps.map((x, i) => <td key={i} style={R}>{fmt(compPrices(x)[k])}</td>)}
              </tr>
            ),
          })),
          { key: 'cs', stick: true, tr: <tr key="cs" data-k="cs"><td colSpan={3} style={R}>รวม ก่อน VAT · Subtotal</td><td style={{ ...R, fontWeight: 700 }}>{fmt(r.subtotal)}</td>{comps.map((x, i) => <td key={i} style={R}>{fmt(x.subtotal)}</td>)}</tr> },
          { key: 'ct', stick: true, tr: <tr key="ct" data-k="ct" style={{ fontWeight: 700 }}><td colSpan={3} style={R}>รวม VAT · Total</td><td style={R}>{fmt(r.total)}</td>{comps.map((x, i) => <td key={i} style={R}>{fmt(x.total)}</td>)}</tr> },
          { key: 'cd', stick: true, tr: <tr key="cd" data-k="cd"><td colSpan={3} style={R}>ส่วนต่าง · Difference</td><td style={R}>ที่เลือก</td>{comps.map((x, i) => <td key={i} style={R}>{diffCell(x.diff)}</td>)}</tr> },
        ],
      };
    }
  }

  const blocks: Block[] = [
    { kind: 'el', key: 'header', node: header, firstPageOnly: true },
    {
      kind: 'el', key: 'title',
      node: (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>หนังสืออนุมัติใบเสนอราคา</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Quotation Approval Cover Letter</div>
        </div>
      ),
    },
    {
      kind: 'el', key: 'subject',
      node: (
        <div>
          <b>เรื่อง · Subject:</b> ขออนุมัติ{subj} {itemTitle} {deptTh(r.dept)}<br />
          <b>เรียน · To:</b> {settings?.recipient || '[ผู้รับ]'}<br />
          <b>สิ่งที่แนบมาด้วย · Enclosure:</b> ใบเสนอราคา {r.quote_no || '—'}
        </div>
      ),
    },
    {
      kind: 'el', key: 'para', keepWithNext: true,
      node: (
        <p style={{ margin: 0, textIndent: 40 }}>
          ตามที่ {deptTh(r.dept)} ได้เสนอขออนุมัติ{subj}{' '}
          {n > 1 ? `รายการสินค้าจำนวน ${n} รายการ` : `${first?.product_name || ''} (SKU ${first?.sku || ''}) จำนวน ${fmtQty(first?.qty)} ${first?.unit || ''}`}{' '}
          เพื่อ{PURP[r.purpose] || ''} จาก {r.vendor} ตามใบเสนอราคาเลขที่ {r.quote_no || '—'}
          {r.quote_date ? ` ลงวันที่ ${thDate(r.quote_date)}` : ''} {draft ? 'โดยขออนุมัติ' : 'บัดนี้ได้รับการอนุมัติครบถ้วน'}ตามอำนาจอนุมัติวงเงิน {tierShort} {draft ? '' : 'แล้ว '}รายละเอียดดังนี้
        </p>
      ),
    },
    { kind: 'table', key: 'items', table: itemsTable },
    { kind: 'el', key: 'cmpTitle', keepWithNext: true, node: <div style={{ fontWeight: 700 }}>การเปรียบเทียบราคา · Price comparison{n > 1 && cmpTable ? ' (ราคาต่อหน่วย ก่อน VAT · unit prices before VAT)' : ''}</div> },
    ...(r.no_comp
      ? [{ kind: 'el', key: 'nocomp', node: <div>ไม่มีคู่เทียบ · No comparison — เหตุผล: {r.no_comp_reason}</div> } as Block]
      : cmpTable
        ? [{ kind: 'table', key: 'cmp', table: cmpTable } as Block]
        : []),
    ...(r.low_reason ? [{ kind: 'el', key: 'low', node: <div style={{ fontSize: 13 }}>เหตุผลที่ไม่เลือกราคาต่ำสุด: {r.low_reason}</div> } as Block] : []),
    { kind: 'el', key: 'close', keepWithNext: true, node: <p style={{ margin: 0, textIndent: 40 }}>จึงเรียนมาเพื่อโปรดทราบและดำเนินการต่อไป · For your information and further action.</p> },
    {
      kind: 'el', key: 'sigs',
      node: (
        <div className="sigs">
          <div className="s">
            <Sig img={r.preparer_signature} ph="" />
            <span className="ln" />
            <span>({prep?.name || ''})</span>
            <span>{prep?.title || ''}</span>
            <b>ผู้จัดทำ · Prepared by</b>
            {proxy && <span>จัดทำแทนโดย {name(r.created_by)}</span>}
            <span>{dOnly(r.submitted_at)}</span>
          </div>
          {ordered.map((s, i) => (
            <div className="s" key={s.step_no}>
              <Sig img={s.status === 'approved' ? s.signature : null} ph="รอลงนาม · Pending" />
              <span className="ln" />
              <span>({name(s.signer_id || s.approver_id)})</span>
              <span>{posTh(s.position)}</span>
              <b>ผู้อนุมัติ {i + 1} · Approved by</b>
              {s.on_behalf_of && <span>อนุมัติแทน {name(s.on_behalf_of)}</span>}
              <span>{s.status === 'approved' ? dOnly(s.acted_at) : ''}</span>
            </div>
          ))}
        </div>
      ),
    },
  ];
  const tables = Object.fromEntries(blocks.filter((b): b is Extract<Block, { kind: 'table' }> => b.kind === 'table').map((b) => [b.table.id, b.table]));
  const els = Object.fromEntries(blocks.filter((b): b is Extract<Block, { kind: 'el' }> => b.kind === 'el').map((b) => [b.key, b]));

  const contHead = (
    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #111', paddingBottom: 6, fontSize: 12, color: '#333' }}>
      <span>{co?.th} · หนังสืออนุมัติใบเสนอราคา (ต่อ) · continued</span>
      <span>เลขที่ · Ref: <b>{refNo}</b></span>
    </div>
  );
  const footer = (page: number, total: number) => (
    <footer style={{ marginTop: 'auto', borderTop: '1px solid var(--tan)', paddingTop: 6, display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11, color: '#444' }}>
      <span>สร้างโดยระบบอนุมัติใบเสนอราคา · Generated by Quotation Approval</span>
      <span>หน้า {page}/{total} · Page {page} of {total}</span>
      <span>รหัสตรวจสอบ · Verify: <span className="mono">{verifyCode(r.id + (r.completed_at || ''))}</span></span>
    </footer>
  );

  // ---------- measure every block off-screen, then fill A4 pages ----------
  const measRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PagePart[][] | null>(null);

  const paginate = () => {
    const box = measRef.current;
    if (!box) return;
    const h = (sel: string) => (box.querySelector(sel) as HTMLElement | null)?.getBoundingClientRect().height || 0;
    const footH = h('[data-m="footer"]');
    const contH = h('[data-m="cont"]');
    const capFor = (p: number) => PAGE_H - PAD_TOP - PAD_BOTTOM - footH - GAP - (p > 0 ? contH + GAP : 0) - SAFETY;

    type Unit = { kind: 'el'; key: string; h: number; keep?: boolean; firstOnly?: boolean } | { kind: 'row'; table: string; key: string; h: number; head: number; stick?: boolean };
    const units: Unit[] = [];
    blocks.forEach((b) => {
      if (b.kind === 'el') {
        units.push({ kind: 'el', key: b.key, h: h(`[data-m="el-${b.key}"]`), keep: b.keepWithNext, firstOnly: b.firstPageOnly });
      } else {
        const tbl = box.querySelector(`table[data-t="${b.table.id}"]`) as HTMLElement | null;
        const head = (tbl?.querySelector('thead') as HTMLElement | null)?.getBoundingClientRect().height || 0;
        b.table.rows.forEach((row) => {
          const tr = tbl?.querySelector(`tr[data-k="${row.key}"]`) as HTMLElement | null;
          units.push({ kind: 'row', table: b.table.id, key: row.key, h: tr?.getBoundingClientRect().height || 0, head, stick: row.stick });
        });
      }
    });

    const out: PagePart[][] = [[]];
    let used = 0;
    const cost = (u: Unit, page: PagePart[], usedNow: number) => {
      const last = page[page.length - 1];
      if (u.kind === 'row' && last?.kind === 'rows' && last.table === u.table) return u.h; // same table segment continues
      const own = u.kind === 'row' ? u.head + u.h : u.h;
      return usedNow === 0 ? own : GAP + own;
    };
    const place = (u: Unit) => {
      const page = out[out.length - 1];
      used += cost(u, page, used);
      const last = page[page.length - 1];
      if (u.kind === 'el') page.push({ kind: 'el', key: u.key });
      else if (last?.kind === 'rows' && last.table === u.table) last.rows.push(u.key);
      else page.push({ kind: 'rows', table: u.table, rows: [u.key] });
    };
    const newPage = () => {
      out.push([]);
      used = 0;
    };
    // chunks that must not be split across pages: a heading with what follows it,
    // and the total rows with the last item row
    const chunks: Unit[][] = [];
    units.forEach((u, idx) => {
      const prev = units[idx - 1];
      const join = (u.kind === 'row' && u.stick) || (prev?.kind === 'el' && prev.keep);
      if (join && chunks.length) chunks[chunks.length - 1].push(u);
      else chunks.push([u]);
    });
    const chunkCost = (chunk: Unit[], page: PagePart[], usedNow: number) => {
      const last = page[page.length - 1];
      let lastTable = last?.kind === 'rows' ? last.table : null;
      let total = 0;
      for (const u of chunk) {
        if (u.kind === 'row' && lastTable === u.table) total += u.h;
        else {
          const own = u.kind === 'row' ? u.head + u.h : u.h;
          total += usedNow + total === 0 ? own : GAP + own;
        }
        lastTable = u.kind === 'row' ? u.table : null;
      }
      return total;
    };
    chunks.forEach((chunk) => {
      const page = out[out.length - 1];
      if (page.length && used + chunkCost(chunk, page, used) > capFor(out.length - 1)) newPage();
      chunk.forEach(place);
    });
    setPages((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  };
  const paginateRef = useRef(paginate);
  paginateRef.current = paginate;

  // re-paginate after every render and whenever the content changes size
  // (Thai web font, logo and signature images loading)
  useLayoutEffect(() => {
    paginateRef.current();
  });
  useEffect(() => {
    const box = measRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => paginateRef.current());
    ro.observe(box);
    document.fonts?.ready.then(() => paginateRef.current());
    return () => ro.disconnect();
  }, []);

  const renderPart = (part: PagePart, i: number) => {
    if (part.kind === 'el') return <div key={part.key}>{els[part.key]?.node}</div>;
    const t = tables[part.table];
    const rows = t.rows.filter((x) => part.rows.includes(x.key));
    return <div key={`${part.table}-${i}`}><LTable t={t} rows={rows} /></div>;
  };

  const shown = pages || [blocks.map((b): PagePart => (b.kind === 'el' ? { kind: 'el', key: b.key } : { kind: 'rows', table: b.table.id, rows: b.table.rows.map((x) => x.key) }))];

  return (
    <>
      <section className="letter-pages" ref={ref} data-ready={pages ? '1' : '0'} aria-label="หนังสืออนุมัติใบเสนอราคา">
        {shown.map((parts, p) => (
          <article className="letter" key={p} aria-label={`หน้า ${p + 1} · Page ${p + 1}`}>
            {draft && <span className="wm" aria-hidden="true">ร่าง · DRAFT</span>}
            {p > 0 && contHead}
            {parts.map(renderPart)}
            {footer(p + 1, shown.length)}
          </article>
        ))}
      </section>
      {/* off-screen copy used only to measure block heights */}
      <div className="letter-measure" aria-hidden="true">
        <div className="letter" ref={measRef}>
          <div data-m="cont">{contHead}</div>
          {blocks.map((b) =>
            b.kind === 'el' ? (
              <div key={b.key} data-m={`el-${b.key}`}>{b.node}</div>
            ) : (
              <div key={b.key}><LTable t={b.table} rows={b.table.rows} /></div>
            ),
          )}
          <div data-m="footer">{footer(1, 1)}</div>
        </div>
      </div>
    </>
  );
});
