'use client';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from './AppProvider';
import { Loading, Modal, PageHead } from './ui';
import { UnitField } from './UnitField';
import type { Company, Product } from '@/lib/types';

const PAGE = 100;
const CO_KEY = 'qa-sku-co';
interface PerCo { add: number; upd: number; same: number }
interface Preview {
  file: string;
  recs: Product[];
  per: Record<string, PerCo>;
  errs: { row: number; sku: string; msg: string }[];
  /** SKU codes in the file that also exist in a company the file does not touch */
  cross: number;
  byColumn: number;
}
type Editing = Product & { isNew?: boolean; cos: string[] };

/** Very small CSV parser (handles quotes and commas inside quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const short = (c?: Company | null) => (c ? c.initials?.trim() || c.th : '—');
const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * SKU product list, one list per buyer company (the same code may exist in several
 * companies: shared, or a different product in a sister company).
 * Everyone signed in can look products up (read-only); only admins (canEdit)
 * import, add, edit, deactivate or clear.
 */
export function ProductList({ canEdit }: { canEdit: boolean }) {
  const { sb, run, toast, bump, refresh, unitRows, reloadRefs, companies } = useApp();
  const cos = useMemo(() => companies.filter((c) => c.active), [companies]);
  const coOf = (id: string) => companies.find((c) => c.id === id) || null;
  // which company's list is shown ('' = every company)
  const [co, setCoState] = useState<string | null>(null);
  useEffect(() => {
    if (co !== null || !cos.length) return;
    let saved = '';
    try { saved = localStorage.getItem(CO_KEY) || ''; } catch { /* no storage */ }
    setCoState(saved === 'all' ? '' : cos.some((c) => c.id === saved) ? saved : cos[0].id);
  }, [cos, co]);
  const setCo = (v: string) => {
    setCoState(v);
    setPage(0);
    try { localStorage.setItem(CO_KEY, v || 'all'); } catch { /* no storage */ }
  };

  const [rows, setRows] = useState<Product[] | null>(null);
  const [others, setOthers] = useState<Record<string, { company_id: string; name: string }[]>>({});
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [impCos, setImpCos] = useState<string[] | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<Editing | null>(null);
  const [clearing, setClearing] = useState<{ counts: Record<string, number>; pick: string[] } | null>(null);
  const [clearBusy, setClearBusy] = useState('');
  const importTo = impCos ?? (co ? [co] : cos.map((c) => c.id));

  useEffect(() => {
    if (co === null) return;
    setRows(null);
    const t = setTimeout(async () => {
      let query = sb.from('products').select('*', { count: 'exact' }).order('sku').order('company_id').range(page * PAGE, page * PAGE + PAGE - 1);
      let act = sb.from('products').select('sku', { count: 'exact', head: true }).eq('active', true);
      if (co) { query = query.eq('company_id', co); act = act.eq('company_id', co); }
      const term = q.trim().replace(/[%,()]/g, '');
      if (term) query = query.or(`sku.ilike.%${term}%,name.ilike.%${term}%`);
      const [{ data, count }, a] = await Promise.all([query, act]);
      const list = (data as Product[]) || [];
      // the same codes in the other companies (shared / duplicate in a sister company)
      const skus = Array.from(new Set(list.map((p) => p.sku)));
      const map: Record<string, { company_id: string; name: string }[]> = {};
      if (skus.length) {
        const { data: ex } = await sb.from('products').select('company_id,sku,name').in('sku', skus);
        ((ex as Product[]) || []).forEach((p) => (map[p.sku] = [...(map[p.sku] || []), { company_id: p.company_id, name: p.name }]));
      }
      setOthers(map);
      setRows(list);
      setTotal(count || 0);
      setActive(a.count || 0);
    }, 250);
    return () => clearTimeout(t);
  }, [sb, q, page, bump, co]);

  /** "A, B" / "ทุกบริษัท" in the file's บริษัท column → company ids (null = unknown name) */
  function parseCos(cell: string): string[] | null {
    const parts = cell.split(/[,;/|\n]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (parts.some((x) => /^(\*|all|ทุกบริษัท|ทั้งหมด)$/.test(x))) return cos.map((c) => c.id);
    const out: string[] = [];
    for (const x of parts) {
      const c = companies.find((c0) => [c0.id, c0.initials, c0.th, c0.en].some((v) => (v || '').trim().toLowerCase() === x));
      if (!c) return null;
      if (!out.includes(c.id)) out.push(c.id);
    }
    return out;
  }

  async function readFile(file: File) {
    try {
      let data: unknown[][];
      if (/\.csv$/i.test(file.name)) data = parseCsv(await file.text());
      else {
        const { readSheet } = await import('read-excel-file/browser');
        data = (await readSheet(file)) as unknown[][];
      }
      if (!data.length) return toast('bad', 'ไฟล์ว่าง · Empty file', '');
      const hd = data[0].map((h) => String(h ?? '').trim().toLowerCase());
      const find = (re: RegExp) => hd.findIndex((h) => re.test(h));
      const iS = find(/sku|item ?code|^code|รหัส/);
      const iN = find(/name|description|desc|ชื่อสินค้า|^ชื่อ/);
      const iC = find(/cat|group|หมวด/);
      const iU = find(/unit|uom|หน่วย/);
      const iB = find(/company|บริษัท/);
      if (iS < 0 || iN < 0) return toast('bad', 'ไม่พบคอลัมน์ที่ต้องการ · Columns not found', 'แถวแรกต้องมีหัวคอลัมน์ SKU และ ชื่อสินค้า · The first row needs SKU and Name headers');

      const body = data.slice(1, 20001);
      const skus = Array.from(new Set(body.map((r) => String(r[iS] ?? '').trim().toUpperCase()).filter(Boolean)));
      const existing = new Map<string, Product>();
      const codeCos = new Map<string, Set<string>>();
      for (let i = 0; i < skus.length; i += 300) {
        const { data: ex } = await sb.from('products').select('*').in('sku', skus.slice(i, i + 300));
        ((ex as Product[]) || []).forEach((p) => {
          existing.set(`${p.company_id}|${p.sku}`, p);
          codeCos.set(p.sku, (codeCos.get(p.sku) || new Set()).add(p.company_id));
        });
      }
      const seen = new Map<string, number>();
      const recs: Product[] = [];
      const per: Record<string, PerCo> = {};
      const errs: Preview['errs'] = [];
      const touched = new Map<string, Set<string>>();
      let byColumn = 0;
      body.forEach((r, k) => {
        const row = k + 2;
        const sku = String(r[iS] ?? '').trim().toUpperCase();
        const name = String(r[iN] ?? '').trim();
        if (!sku && !name) return;
        if (!sku) return errs.push({ row, sku, msg: 'ไม่มี SKU · Missing SKU' });
        if (!name) return errs.push({ row, sku, msg: 'ไม่มีชื่อสินค้า · Missing name' });
        if (sku.length > 60) return errs.push({ row, sku, msg: 'SKU ยาวเกิน 60 ตัวอักษร · SKU too long' });
        const cell = iB > -1 ? String(r[iB] ?? '').trim() : '';
        const targets = cell ? parseCos(cell) : importTo;
        if (!targets) return errs.push({ row, sku, msg: `ไม่รู้จักบริษัท “${cell}” · Unknown company` });
        if (!targets.length) return errs.push({ row, sku, msg: 'ยังไม่ได้เลือกบริษัท · No company chosen' });
        if (cell) byColumn++;
        const category = iC > -1 ? String(r[iC] ?? '').trim() : '';
        const unit = iU > -1 ? String(r[iU] ?? '').trim() : '';
        for (const c of targets) {
          const key = `${c}|${sku}`;
          if (seen.has(key)) { errs.push({ row, sku, msg: `SKU ซ้ำในไฟล์สำหรับ ${short(coOf(c))} (แถว ${seen.get(key)}) · Duplicate` }); continue; }
          seen.set(key, row);
          touched.set(sku, (touched.get(sku) || new Set()).add(c));
          const ex = existing.get(key);
          const rec: Product = { company_id: c, sku, name, category: category || ex?.category || '', unit: unit || ex?.unit || '', active: true };
          const pc = (per[c] ||= { add: 0, upd: 0, same: 0 });
          if (!ex) { pc.add++; recs.push(rec); }
          else if (ex.name !== rec.name || ex.category !== rec.category || ex.unit !== rec.unit || !ex.active) { pc.upd++; recs.push(rec); }
          else pc.same++;
        }
      });
      const cross = Array.from(touched.entries()).filter(([sku, t]) => Array.from(codeCos.get(sku) || []).some((c) => !t.has(c))).length;
      setPv({ file: file.name, recs, per, errs, cross, byColumn });
    } catch (e: any) {
      toast('bad', 'อ่านไฟล์ไม่สำเร็จ · Could not read the file', e?.message || 'ใช้ไฟล์ .xlsx หรือ .csv · Use an .xlsx or .csv file');
    }
  }

  async function doImport() {
    if (!pv) return;
    setBusy(true);
    const all = pv.recs.map((p) => ({ ...p, updated_at: new Date().toISOString() }));
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < all.length; i += 500) {
      const chunk = all.slice(i, i + 500);
      const r = await run('import-products', sb.from('products').upsert(chunk, { onConflict: 'company_id,sku' }));
      if (r.ok) ok += chunk.length;
      else fail += chunk.length;
    }
    setBusy(false);
    setPv(null);
    toast(fail ? 'bad' : 'ok', fail ? 'นำเข้าบางส่วน · Partly imported' : 'นำเข้าสำเร็จ · Import done', `สำเร็จ ${ok} รายการ${fail ? ` · ไม่สำเร็จ ${fail} รายการ ลองอีกครั้ง` : ''}`);
    refresh();
  }

  async function template() {
    const { default: writeExcelFile } = await import('write-excel-file/browser');
    const H = (v: string) => ({ value: v, fontWeight: 'bold' as const, backgroundColor: '#EFE6DA' });
    const both = cos.slice(0, 2).map(short).join(', ');
    await writeExcelFile([
      { data: [
        ['SKU', 'ชื่อสินค้า', 'หมวด', 'หน่วย', 'บริษัท (เว้นว่าง = ตามที่ติ๊กในหน้าจอ)'].map(H),
        ['AC-INV-18000', 'เครื่องปรับอากาศ Inverter 18,000 BTU', 'เครื่องใช้ไฟฟ้า', 'เครื่อง', ''],
        ['PPR-A4-80', 'กระดาษ A4 80 แกรม', 'วัสดุสำนักงาน', 'รีม', both],
      ] as never, sheet: 'SKU', stickyRowsCount: 1, columns: [18, 40, 18, 10, 34].map((width) => ({ width })) },
      { data: [
        [H('คอลัมน์ บริษัท'), H('')],
        ['เว้นว่าง', 'นำเข้าให้บริษัทที่ติ๊กในหน้าจอก่อนเลือกไฟล์'],
        ['ชื่อย่อ / รหัส คั่นด้วย ,', 'นำเข้าให้เฉพาะบริษัทนั้น เช่น SKU ที่ใช้ร่วมกันใส่หลายบริษัท'],
        ['ทุกบริษัท', 'นำเข้าให้ทุกบริษัท'],
        ['', ''],
        [H('บริษัทในระบบ'), H('ใส่ได้')],
        ...cos.map((c) => [c.th, [c.initials, c.id].filter(Boolean).join(' หรือ ')]),
      ] as never, sheet: 'วิธีกรอก', columns: [{ width: 44 }, { width: 70 }] },
    ]).toFile('sku-template.xlsx');
  }

  async function toggle(p: Product) {
    const { ok } = await run('toggle-product', sb.from('products').update({ active: !p.active, updated_at: new Date().toISOString() }).eq('company_id', p.company_id).eq('sku', p.sku));
    if (ok) setRows((list) => (list || []).map((x) => (x.sku === p.sku && x.company_id === p.company_id ? { ...x, active: !p.active } : x)));
  }

  async function saveOne() {
    if (!adding) return;
    const sku = adding.sku.trim().toUpperCase();
    if (!sku || !adding.name.trim()) return toast('bad', 'กรอก SKU และชื่อสินค้า · SKU and name required', '');
    if (!adding.cos.length) return toast('bad', 'ติ๊กบริษัทอย่างน้อย 1 บริษัท · Choose a company', '');
    const unit = adding.unit.trim();
    const base = { sku, unit, name: adding.name.trim(), category: adding.category.trim(), active: adding.active, updated_at: new Date().toISOString() };
    const { ok } = await run('add-product', sb.from('products').upsert(adding.cos.map((c) => ({ ...base, company_id: c })), { onConflict: 'company_id,sku' }));
    if (ok) {
      // a unit typed by hand joins the units list (ตั้งค่าระบบ → หน่วยสินค้า)
      if (unit && !unitRows.some((u) => u.name === unit)) {
        const r = await sb.from('units').upsert({ name: unit, sort: (unitRows.at(-1)?.sort || 0) + 10 }, { onConflict: 'name', ignoreDuplicates: true });
        if (!r.error) reloadRefs();
      }
      toast('ok', 'บันทึกสินค้าแล้ว · Product saved', `${sku} · ${adding.cos.map((c) => short(coOf(c))).join(', ')}`);
      setAdding(null);
      refresh();
    }
  }

  async function askClear() {
    const counts: Record<string, number> = {};
    await Promise.all(cos.map(async (c) => {
      const { count } = await sb.from('products').select('sku', { count: 'exact', head: true }).eq('company_id', c.id);
      counts[c.id] = count || 0;
    }));
    setClearing({ counts, pick: co ? [co] : cos.map((c) => c.id) });
  }
  const clearN = clearing ? clearing.pick.reduce((a, c) => a + (clearing.counts[c] || 0), 0) : 0;
  async function backup() {
    if (!clearing) return;
    setClearBusy('กำลังเตรียมไฟล์… · Preparing…');
    try {
      const list: Product[] = [];
      for (let from = 0; from < 100000; from += 1000) {
        const { data } = await sb.from('products').select('*').in('company_id', clearing.pick).order('company_id').order('sku').range(from, from + 999);
        const part = (data as Product[]) || [];
        list.push(...part);
        if (part.length < 1000) break;
      }
      const { default: writeExcelFile } = await import('write-excel-file/browser');
      await writeExcelFile([
        ['SKU', 'ชื่อสินค้า', 'หมวด', 'หน่วย', 'บริษัท', 'สถานะ'],
        ...list.map((x) => [x.sku, x.name, x.category, x.unit, short(coOf(x.company_id)), x.active ? 'ใช้งาน' : 'ปิดใช้งาน']),
      ]).toFile(`sku-backup-${stamp()}.xlsx`);
    } finally {
      setClearBusy('');
    }
  }
  async function clearAll() {
    if (!clearing?.pick.length) return;
    setClearBusy('กำลังลบ… · Clearing…');
    const { ok, data } = await run<number>('clear-products', sb.rpc('admin_clear_products', { p_confirm: 'ลบทั้งหมด', p_companies: clearing.pick }));
    setClearBusy('');
    if (ok) {
      const names = clearing.pick.map((c) => short(coOf(c))).join(', ');
      setClearing(null);
      setPv(null);
      toast('ok', 'ลบ SKU แล้ว · SKUs cleared', `ลบ ${(data ?? 0).toLocaleString('en-US')} รายการ (${names}) · อัปโหลดไฟล์ใหม่ได้เลย`);
      refresh();
    }
  }

  const tick = (list: string[], id: string, on: boolean) => (on ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id));
  const coName = co ? coOf(co)?.th : 'ทุกบริษัท';
  const pvTotal = pv ? Object.values(pv.per).reduce((a, x) => ({ add: a.add + x.add, upd: a.upd + x.upd, same: a.same + x.same }), { add: 0, upd: 0, same: 0 }) : null;

  return (
    <>
      <PageHead title="รายการสินค้า SKU" lead={canEdit ? 'SKU product list per company — upload Excel for each company; when a preparer types a SKU, the name comes from the buyer company’s list' : 'SKU product list — choose the company to look up its SKUs · ดูได้อย่างเดียว เพิ่มหรือแก้ไขได้เฉพาะผู้ดูแลระบบ'}>
        {canEdit && <button className="btn" onClick={template}>ดาวน์โหลดไฟล์ต้นแบบ · Template</button>}
      </PageHead>

      <div className="co-tabs" role="tablist" aria-label="บริษัท · Company">
        {cos.map((c) => (
          <button key={c.id} role="tab" aria-selected={co === c.id} className={`btn sm${co === c.id ? ' p' : ''}`} onClick={() => setCo(c.id)} title={c.th}>{c.th}</button>
        ))}
        {cos.length > 1 && <button role="tab" aria-selected={co === ''} className={`btn sm${co === '' ? ' p' : ''}`} onClick={() => setCo('')}>ทุกบริษัท · All</button>}
      </div>

      <div className="tiles">
        <div className="tile"><span>SKU {co ? `· ${short(coOf(co))}` : 'ทุกบริษัท'}</span><b>{q ? '—' : total.toLocaleString('en-US')}</b></div>
        <div className="tile"><span>ใช้งาน · Active</span><b>{active.toLocaleString('en-US')}</b></div>
      </div>

      {canEdit && <div className="card">
        <div className="actions">
          <h2>นำเข้าจาก Excel · Import from Excel</h2>
          <button className="btn d sm" id="sku-clear" onClick={askClear} title="ลบ SKU ทั้งหมดของบริษัทที่เลือก แล้วอัปโหลดไฟล์ใหม่ · Remove every SKU of the chosen companies, then upload a new file">🗑 ลบ SKU ทั้งหมด · Clear all</button>
        </div>
        <fieldset className="co-pick">
          <legend>นำเข้าให้บริษัท · Import into</legend>
          {cos.map((c) => (
            <label key={c.id} className="check"><input type="checkbox" className="imp-co" value={c.id} checked={importTo.includes(c.id)} onChange={(e) => { setImpCos(tick(importTo, c.id, e.target.checked)); setPv(null); }} />{c.th}</label>
          ))}
          <span className="note">ติ๊กหลายบริษัท = SKU ใช้ร่วมกัน · หรือใส่คอลัมน์ “บริษัท” ในไฟล์เพื่อกำหนดรายแถว (แถวที่ใส่จะใช้ตามไฟล์)</span>
        </fieldset>
        <label className="box" htmlFor="sku-file" style={{ textAlign: 'center', cursor: 'pointer', display: 'block' }}>
          <b>เลือกไฟล์ .xlsx / .csv · Choose file</b>
          <div className="note">คอลัมน์ · Columns: SKU, ชื่อสินค้า (Name) · ไม่บังคับ · optional: หมวด, หน่วย, บริษัท · สูงสุด 20,000 แถวต่อไฟล์</div>
          <input type="file" id="sku-file" accept=".xlsx,.csv" className="sr" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readFile(f); }} />
        </label>
        {pv && pvTotal && (
          <>
            <div className="tiles">
              <div className="tile"><span>เพิ่มใหม่ · New</span><b>{pvTotal.add}</b></div>
              <div className="tile"><span>อัปเดต · Update</span><b>{pvTotal.upd}</b></div>
              <div className="tile"><span>ไม่เปลี่ยน · Unchanged</span><b>{pvTotal.same}</b></div>
              <div className="tile"><span style={{ color: 'var(--bad)' }}>มีปัญหา · Errors</span><b>{pv.errs.length}</b></div>
            </div>
            <div className="tw">
              <table className="t" style={{ minWidth: 420 }}>
                <thead><tr><th>บริษัท · Company</th><th className="num">เพิ่มใหม่</th><th className="num">อัปเดต</th><th className="num">ไม่เปลี่ยน</th></tr></thead>
                <tbody>{Object.entries(pv.per).map(([c, x]) => <tr key={c}><td>{coOf(c)?.th || c}</td><td className="num">{x.add}</td><td className="num">{x.upd}</td><td className="num">{x.same}</td></tr>)}</tbody>
              </table>
            </div>
            {(pv.cross > 0 || pv.byColumn > 0) && (
              <div className="note">
                {pv.byColumn > 0 && <>ใช้บริษัทตามคอลัมน์ “บริษัท” ในไฟล์ {pv.byColumn} แถว · </>}
                {pv.cross > 0 && <>มี {pv.cross} รหัสที่ซ้ำกับ SKU ของบริษัทอื่นที่ไม่ได้เลือก — ของบริษัทนั้นไม่ถูกแก้ไข</>}
              </div>
            )}
            {pv.errs.length > 0 && (
              <div className="tw">
                <table className="t" style={{ minWidth: 480 }}>
                  <thead><tr><th>แถว · Row</th><th>SKU</th><th>ปัญหา · Problem</th></tr></thead>
                  <tbody>{pv.errs.slice(0, 50).map((e, i) => <tr key={i}><td>{e.row}</td><td className="mono">{e.sku || '—'}</td><td style={{ color: 'var(--bad)' }}>{e.msg}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            <div className="actions">
              <span className="note">{pv.file} · แถวที่มีปัญหาจะถูกข้าม · Rows with problems are skipped</span>
              <span className="row" style={{ gap: 10 }}>
                <button className="btn" onClick={() => setPv(null)}>ยกเลิก · Cancel</button>
                <button className="btn p" id="sku-import" disabled={busy || !pv.recs.length} onClick={doImport}>{busy ? 'กำลังนำเข้า… · Importing…' : `นำเข้า ${pv.recs.length} รายการ · Import`}</button>
              </span>
            </div>
          </>
        )}
      </div>}

      <div className="card">
        <div className="actions">
          <h2>สินค้า · {coName}</h2>
          {canEdit
            ? <button className="btn o sm" onClick={() => setAdding({ company_id: co || '', sku: '', name: '', category: '', unit: 'ชิ้น', active: true, isNew: true, cos: co ? [co] : cos.map((c) => c.id) })}>+ เพิ่มทีละรายการ · Add one</button>
            : <span className="chip st-draft">ดูอย่างเดียว · View only</span>}
        </div>
        <label className="f"><span className="sr">ค้นหา · Search</span>
          <input className="in" type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="ค้นหา SKU หรือชื่อสินค้า · Search SKU or name" />
        </label>
        {rows === null ? <Loading /> : (
          <div className="tw">
            <table className="t" style={{ minWidth: 760 }}>
              <thead><tr><th>SKU</th><th>ชื่อสินค้า · Product</th><th>หมวด</th><th>หน่วย</th><th>บริษัท · Company</th><th>สถานะ</th>{canEdit && <th><span className="sr">Actions</span></th>}</tr></thead>
              <tbody>
                {rows.map((p) => {
                  const rest = (others[p.sku] || []).filter((o) => o.company_id !== p.company_id);
                  const same = rest.filter((o) => o.name === p.name);
                  const diff = rest.filter((o) => o.name !== p.name);
                  return (
                    <tr key={`${p.company_id}|${p.sku}`}>
                      <td className="mono" style={{ fontSize: 13 }}>{p.sku}</td>
                      <td>{p.name}</td>
                      <td>{p.category || '—'}</td>
                      <td>{p.unit || '—'}</td>
                      <td className="co-cell">
                        <b style={{ fontWeight: 500 }}>{short(coOf(p.company_id))}</b>
                        {same.length > 0 && <span className="chip st-ok" title="รหัสและชื่อเดียวกัน">ใช้ร่วมกับ {same.map((o) => short(coOf(o.company_id))).join(', ')}</span>}
                        {diff.length > 0 && <span className="chip st-pend" title={diff.map((o) => `${coOf(o.company_id)?.th}: ${o.name}`).join('\n')}>รหัสซ้ำกับ {diff.map((o) => short(coOf(o.company_id))).join(', ')} (คนละสินค้า)</span>}
                      </td>
                      <td>{p.active ? <span className="chip st-ok">ใช้งาน</span> : <span className="chip st-draft">ปิดใช้งาน</span>}</td>
                      {canEdit && (
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn sm" onClick={() => setAdding({ ...p, cos: [p.company_id] })}>แก้ไข</button>{' '}
                          <button className="btn sm" onClick={() => toggle(p)}>{p.active ? 'ปิดใช้ · Deactivate' : 'เปิดใช้ · Activate'}</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={canEdit ? 7 : 6} className="note">ไม่พบ · No match</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE && (
          <div className="pager">
            <span className="note">{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} จาก {total}</span>
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← ก่อนหน้า</button>
            <button className="btn sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>ถัดไป →</button>
          </div>
        )}
      </div>

      {canEdit && clearing && (
        <Modal title="ลบ SKU ทั้งหมด · Clear all SKUs" onClose={() => !clearBusy && setClearing(null)}>
          <fieldset className="co-pick">
            <legend>ลบ SKU ของบริษัท · Clear for</legend>
            {cos.map((c) => (
              <label key={c.id} className="check"><input type="checkbox" className="clr-co" checked={clearing.pick.includes(c.id)} onChange={(e) => setClearing({ ...clearing, pick: tick(clearing.pick, c.id, e.target.checked) })} />{c.th} ({(clearing.counts[c.id] || 0).toLocaleString('en-US')} รายการ)</label>
            ))}
          </fieldset>
          <p style={{ margin: 0 }}>ลบสินค้า<b> {clearN.toLocaleString('en-US')} รายการ </b>ออกจากระบบ แล้วอัปโหลดไฟล์ใหม่ในช่อง “นำเข้าจาก Excel” · SKU ของบริษัทที่ไม่ได้ติ๊กยังอยู่ครบ</p>
          <ul className="note" style={{ margin: 0, paddingLeft: 18 }}>
            <li>คำขอที่ส่งแล้ว ไม่กระทบ (คำขอเก็บ SKU ชื่อสินค้า และหน่วยไว้แล้ว)</li>
            <li>ฉบับร่างที่ยังไม่ส่ง จะส่งได้เมื่อ SKU นั้นถูกอัปโหลดกลับเข้ามา</li>
            <li>กู้คืนไม่ได้ — ดาวน์โหลดไฟล์สำรองไว้ก่อนได้</li>
          </ul>
          <div className="actions">
            <button className="btn sm" onClick={backup} disabled={!!clearBusy || !clearN}>ดาวน์โหลดสำรอง (.xlsx) · Backup</button>
            <span className="row" style={{ gap: 10 }}>
              <button className="btn" onClick={() => setClearing(null)} disabled={!!clearBusy}>ยกเลิก · Cancel</button>
              <button className="btn d" id="sku-clear-go" onClick={clearAll} disabled={!!clearBusy || !clearN}>{clearBusy || `ลบ ${clearN.toLocaleString('en-US')} รายการ · Clear`}</button>
            </span>
          </div>
        </Modal>
      )}

      {canEdit && adding && (
        <Modal title={adding.isNew ? 'เพิ่มสินค้า · Add product' : 'แก้ไขสินค้า · Edit product'} onClose={() => setAdding(null)}>
          <label className="f">SKU <span className="req">*</span><input className="in mono" value={adding.sku} disabled={!adding.isNew} onChange={(e) => setAdding({ ...adding, sku: e.target.value })} /></label>
          <label className="f">ชื่อสินค้า · Name <span className="req">*</span><input className="in" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></label>
          <div className="grid">
            <label className="f">หมวด · Category<input className="in" value={adding.category} onChange={(e) => setAdding({ ...adding, category: e.target.value })} /></label>
            <label className="f">หน่วย · Unit
              <UnitField id="p-unit" value={adding.unit} onChange={(v) => setAdding({ ...adding, unit: v })} />
            </label>
          </div>
          {adding.isNew ? (
            <fieldset className="co-pick">
              <legend>บริษัท · Company <span className="req">*</span></legend>
              {cos.map((c) => (
                <label key={c.id} className="check"><input type="checkbox" className="add-co" checked={adding.cos.includes(c.id)} onChange={(e) => setAdding({ ...adding, cos: tick(adding.cos, c.id, e.target.checked) })} />{c.th}</label>
              ))}
              <span className="note">ติ๊กหลายบริษัท = ใช้ SKU นี้ร่วมกัน</span>
            </fieldset>
          ) : <span className="note">บริษัท · Company: <b>{coOf(adding.company_id)?.th}</b></span>}
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setAdding(null)}>ยกเลิก</button>
            <button className="btn p" onClick={saveOne}>บันทึก · Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}
