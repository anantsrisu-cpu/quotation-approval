'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { AdminGate } from '@/components/AdminGate';
import { Loading, Modal, PageHead } from '@/components/ui';
import { UNITS } from '@/lib/format';
import type { Product } from '@/lib/types';

const PAGE = 100;
interface Preview { file: string; add: Product[]; upd: Product[]; same: number; errs: { row: number; sku: string; msg: string }[] }

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

function Products() {
  const { sb, run, toast, bump, refresh } = useApp();
  const [rows, setRows] = useState<Product[] | null>(null);
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<Product | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      let query = sb.from('products').select('*', { count: 'exact' }).order('sku').range(page * PAGE, page * PAGE + PAGE - 1);
      const term = q.trim().replace(/[%,()]/g, '');
      if (term) query = query.or(`sku.ilike.%${term}%,name.ilike.%${term}%`);
      const [{ data, count }, a] = await Promise.all([query, sb.from('products').select('sku', { count: 'exact', head: true }).eq('active', true)]);
      setRows((data as Product[]) || []);
      setTotal(count || 0);
      setActive(a.count || 0);
    }, 250);
    return () => clearTimeout(t);
  }, [sb, q, page, bump]);

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
      const iN = find(/name|description|desc|ชื่อ/);
      const iC = find(/cat|group|หมวด/);
      const iU = find(/unit|uom|หน่วย/);
      if (iS < 0 || iN < 0) return toast('bad', 'ไม่พบคอลัมน์ที่ต้องการ · Columns not found', 'แถวแรกต้องมีหัวคอลัมน์ SKU และ ชื่อสินค้า · The first row needs SKU and Name headers');

      const body = data.slice(1, 20001);
      const skus = Array.from(new Set(body.map((r) => String(r[iS] ?? '').trim().toUpperCase()).filter(Boolean)));
      const existing = new Map<string, Product>();
      for (let i = 0; i < skus.length; i += 300) {
        const { data: ex } = await sb.from('products').select('*').in('sku', skus.slice(i, i + 300));
        ((ex as Product[]) || []).forEach((p) => existing.set(p.sku, p));
      }
      const seen = new Map<string, number>();
      const add: Product[] = [];
      const upd: Product[] = [];
      const errs: Preview['errs'] = [];
      let same = 0;
      body.forEach((r, k) => {
        const row = k + 2;
        const sku = String(r[iS] ?? '').trim().toUpperCase();
        const name = String(r[iN] ?? '').trim();
        if (!sku && !name) return;
        if (!sku) return errs.push({ row, sku, msg: 'ไม่มี SKU · Missing SKU' });
        if (!name) return errs.push({ row, sku, msg: 'ไม่มีชื่อสินค้า · Missing name' });
        if (sku.length > 60) return errs.push({ row, sku, msg: 'SKU ยาวเกิน 60 ตัวอักษร · SKU too long' });
        if (seen.has(sku)) return errs.push({ row, sku, msg: `SKU ซ้ำในไฟล์ (แถว ${seen.get(sku)}) · Duplicate` });
        seen.set(sku, row);
        const category = iC > -1 ? String(r[iC] ?? '').trim() : '';
        const unit = iU > -1 ? String(r[iU] ?? '').trim() : '';
        const ex = existing.get(sku);
        const rec: Product = { sku, name, category: category || ex?.category || '', unit: unit || ex?.unit || '', active: true };
        if (!ex) add.push(rec);
        else if (ex.name !== rec.name || ex.category !== rec.category || ex.unit !== rec.unit || !ex.active) upd.push(rec);
        else same++;
      });
      setPv({ file: file.name, add, upd, same, errs });
    } catch (e: any) {
      toast('bad', 'อ่านไฟล์ไม่สำเร็จ · Could not read the file', e?.message || 'ใช้ไฟล์ .xlsx หรือ .csv · Use an .xlsx or .csv file');
    }
  }

  async function doImport() {
    if (!pv) return;
    setBusy(true);
    const all = [...pv.add, ...pv.upd].map((p) => ({ ...p, updated_at: new Date().toISOString() }));
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < all.length; i += 500) {
      const chunk = all.slice(i, i + 500);
      const r = await run('import-products', sb.from('products').upsert(chunk));
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
    await writeExcelFile([
      ['SKU', 'ชื่อสินค้า', 'หมวด', 'หน่วย'],
      ['AC-INV-18000', 'เครื่องปรับอากาศ Inverter 18,000 BTU', 'เครื่องใช้ไฟฟ้า', 'เครื่อง'],
      ['PPR-A4-80', 'กระดาษ A4 80 แกรม', 'วัสดุสำนักงาน', 'รีม'],
    ]).toFile('sku-template.xlsx');
  }

  async function toggle(p: Product) {
    const { ok } = await run('toggle-product', sb.from('products').update({ active: !p.active, updated_at: new Date().toISOString() }).eq('sku', p.sku));
    if (ok) setRows((list) => (list || []).map((x) => (x.sku === p.sku ? { ...x, active: !p.active } : x)));
  }

  async function saveOne() {
    if (!adding) return;
    const sku = adding.sku.trim().toUpperCase();
    if (!sku || !adding.name.trim()) return toast('bad', 'กรอก SKU และชื่อสินค้า · SKU and name required', '');
    const { ok } = await run('add-product', sb.from('products').upsert({ ...adding, sku, name: adding.name.trim(), updated_at: new Date().toISOString() }));
    if (ok) {
      toast('ok', 'บันทึกสินค้าแล้ว · Product saved', sku);
      setAdding(null);
      refresh();
    }
  }

  return (
    <>
      <PageHead title="รายการสินค้า SKU" lead="SKU product list — upload Excel; when a preparer types a SKU the product name fills in by itself">
        <button className="btn" onClick={template}>ดาวน์โหลดไฟล์ต้นแบบ · Template</button>
      </PageHead>
      <div className="tiles">
        <div className="tile"><span>SKU ทั้งหมด · Total</span><b>{q ? '—' : total}</b></div>
        <div className="tile"><span>ใช้งาน · Active</span><b>{active}</b></div>
      </div>
      <div className="card">
        <h2>นำเข้าจาก Excel · Import from Excel</h2>
        <label className="box" htmlFor="sku-file" style={{ textAlign: 'center', cursor: 'pointer', display: 'block' }}>
          <b>เลือกไฟล์ .xlsx / .csv · Choose file</b>
          <div className="note">คอลัมน์ · Columns: SKU, ชื่อสินค้า (Name) · ไม่บังคับ · optional: หมวด (Category), หน่วย (Unit) · สูงสุด 20,000 แถวต่อไฟล์</div>
          <input type="file" id="sku-file" accept=".xlsx,.csv" className="sr" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readFile(f); }} />
        </label>
        {pv && (
          <>
            <div className="tiles">
              <div className="tile"><span>เพิ่มใหม่ · New</span><b>{pv.add.length}</b></div>
              <div className="tile"><span>อัปเดต · Update</span><b>{pv.upd.length}</b></div>
              <div className="tile"><span>ไม่เปลี่ยน · Unchanged</span><b>{pv.same}</b></div>
              <div className="tile"><span style={{ color: 'var(--bad)' }}>มีปัญหา · Errors</span><b>{pv.errs.length}</b></div>
            </div>
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
                <button className="btn p" disabled={busy || !(pv.add.length + pv.upd.length)} onClick={doImport}>{busy ? 'กำลังนำเข้า… · Importing…' : `นำเข้า ${pv.add.length + pv.upd.length} รายการ · Import`}</button>
              </span>
            </div>
          </>
        )}
      </div>
      <div className="card">
        <div className="actions">
          <h2>สินค้าในระบบ · Products</h2>
          <button className="btn o sm" onClick={() => setAdding({ sku: '', name: '', category: '', unit: 'ชิ้น', active: true })}>+ เพิ่มทีละรายการ · Add one</button>
        </div>
        <label className="f"><span className="sr">ค้นหา · Search</span>
          <input className="in" type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="ค้นหา SKU หรือชื่อสินค้า · Search SKU or name" />
        </label>
        {rows === null ? <Loading /> : (
          <div className="tw">
            <table className="t" style={{ minWidth: 640 }}>
              <thead><tr><th>SKU</th><th>ชื่อสินค้า · Product</th><th>หมวด</th><th>หน่วย</th><th>สถานะ</th><th><span className="sr">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.sku}>
                    <td className="mono" style={{ fontSize: 13 }}>{p.sku}</td>
                    <td>{p.name}</td>
                    <td>{p.category || '—'}</td>
                    <td>{p.unit || '—'}</td>
                    <td>{p.active ? <span className="chip st-ok">ใช้งาน</span> : <span className="chip st-draft">ปิดใช้งาน</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn sm" onClick={() => setAdding({ ...p })}>แก้ไข</button>{' '}
                      <button className="btn sm" onClick={() => toggle(p)}>{p.active ? 'ปิดใช้ · Deactivate' : 'เปิดใช้ · Activate'}</button>
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6} className="note">ไม่พบ · No match</td></tr>}
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

      {adding && (
        <Modal title="สินค้า · Product" onClose={() => setAdding(null)}>
          <label className="f">SKU <span className="req">*</span><input className="in mono" value={adding.sku} onChange={(e) => setAdding({ ...adding, sku: e.target.value })} /></label>
          <label className="f">ชื่อสินค้า · Name <span className="req">*</span><input className="in" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></label>
          <div className="grid">
            <label className="f">หมวด · Category<input className="in" value={adding.category} onChange={(e) => setAdding({ ...adding, category: e.target.value })} /></label>
            <label className="f">หน่วย · Unit
              <select className="in" value={adding.unit} onChange={(e) => setAdding({ ...adding, unit: e.target.value })}>
                {Array.from(new Set([...UNITS, adding.unit].filter(Boolean))).map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
          </div>
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setAdding(null)}>ยกเลิก</button>
            <button className="btn p" onClick={saveOne}>บันทึก · Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <AdminGate><Products /></AdminGate>;
}
