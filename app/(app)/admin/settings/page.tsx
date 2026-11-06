'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { AdminGate } from '@/components/AdminGate';
import { PageHead } from '@/components/ui';
import { fmt, num } from '@/lib/format';
import type { Company, DeliveryPlace, Department, Position, Profile, Tier, UnitRow } from '@/lib/types';

type TierEdit = Omit<Tier, 'id' | 'max_amount'> & { id?: number; max: string };
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
/** First code used by more than one row (saving such a list fails in the database), or null. */
const dupCode = (codes: string[]) => codes.find((c, i) => c && codes.indexOf(c) !== i) ?? null;

/** 1000000 → "1,000,000" · 1000000.5 → "1,000,000.50" */
const baht = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : fmt(n));
type TierLike = { max: number | null; steps: string[]; label: string };
/**
 * Amount range of each tier, in order: a tier covers everything above the
 * previous tier's limit up to and including its own (same rule as the database).
 */
function tierRanges<T extends TierLike>(list: T[]) {
  const sorted = [...list].sort((a, b) => (a.max ?? Infinity) - (b.max ?? Infinity));
  let prev: number | null = null;
  return sorted.map((t) => {
    const from = prev == null ? 1 : Number.isInteger(prev) ? prev + 1 : Math.round((prev + 0.01) * 100) / 100;
    const r = { tier: t, from, to: t.max, prev };
    prev = t.max;
    return r;
  });
}
const rangeText = (from: number, to: number | null, prev: number | null) =>
  to == null ? (prev == null ? 'ทุกยอด' : `มากกว่า ${baht(prev)}`) : `${baht(from)}-${baht(to)}`;

function General() {
  const { sb, settings, run, toast, reloadRefs } = useApp();
  const [vat, setVat] = useState('7');
  const [rec, setRec] = useState('');
  const [prefix, setPrefix] = useState('QT');
  useEffect(() => {
    if (!settings) return;
    setVat(String(Math.round(settings.vat_rate * 10000) / 100));
    setRec(settings.recipient);
    setPrefix(settings.request_prefix);
  }, [settings]);
  async function save() {
    const v = num(vat);
    if (v < 0 || v >= 100) return toast('bad', 'VAT ไม่ถูกต้อง · Invalid VAT', '');
    if (!/^[A-Za-z0-9-]{1,10}$/.test(prefix)) return toast('bad', 'รหัสนำหน้าเลขที่ใช้ได้เฉพาะ A–Z 0–9 · Prefix: letters/digits only', '');
    const { ok } = await run('save-settings', sb.from('app_settings').update({ vat_rate: v / 100, recipient: rec.trim(), request_prefix: prefix.toUpperCase(), updated_at: new Date().toISOString() }).eq('id', 1));
    if (ok) { toast('ok', 'บันทึกแล้ว · Saved', 'คำขอใหม่ใช้ค่านี้ทันที · New requests use this now'); reloadRefs(); }
  }
  return (
    <div className="card">
      <div className="actions"><h2>ค่าทั่วไป · General</h2><button className="btn p sm" onClick={save}>บันทึก · Save</button></div>
      <div className="grid">
        <label className="f">VAT (%)<input className="in r" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} /></label>
        <label className="f">รหัสนำหน้าเลขที่ · Number prefix<input className="in mono" value={prefix} onChange={(e) => setPrefix(e.target.value)} /><span className="note" style={{ fontWeight: 400 }}>เช่น {prefix || 'QT'}-{new Date().getFullYear()}-0001</span></label>
        <label className="f span2">ผู้รับในหนังสือ (เรียน) · Letter recipient<input className="in" value={rec} onChange={(e) => setRec(e.target.value)} /></label>
      </div>
    </div>
  );
}

function Positions() {
  const { sb, positions, tiers, run, toast, reloadRefs } = useApp();
  const [rows, setRows] = useState<(Position & { isNew?: boolean })[]>([]);
  useEffect(() => setRows(positions.map((p) => ({ ...p }))), [positions]);
  async function save() {
    for (const p of rows) {
      if (!p.code || !p.th.trim()) return toast('bad', 'กรอกรหัสและชื่อตำแหน่งให้ครบ · Code and Thai name required', '');
      if (!/^[a-z0-9_]{1,20}$/.test(p.code)) return toast('bad', 'รหัสตำแหน่งใช้ a–z 0–9 _ · Code: a–z, 0–9, _', p.code);
    }
    const dup = dupCode(rows.map((p) => p.code));
    if (dup) return toast('bad', `รหัสตำแหน่ง “${dup}” ซ้ำกัน · Duplicate code`, 'แก้รหัสของแถวที่เพิ่มใหม่ให้ไม่ซ้ำกับตำแหน่งที่มีอยู่ แล้วกดบันทึกอีกครั้ง · Give the new row a different code');
    const { ok } = await run('save-positions', sb.from('positions').upsert(rows.map(({ code, th, en, sort, note, sign_mode }) => ({ code, th: th.trim(), en: en.trim(), sort: Number(sort) || 0, note: (note || '').trim(), sign_mode: sign_mode || 'online' }))));
    if (ok) { toast('ok', 'บันทึกตำแหน่งแล้ว · Positions saved', ''); reloadRefs(); }
  }
  /** ช่วงวงเงิน of each position = the tiers whose approval ends at that position */
  function fillFromTiers() {
    const R = tierRanges(tiers.map((t) => ({ label: t.label, steps: t.steps, max: t.max_amount })));
    const order = [...rows].sort((a, b) => a.sort - b.sort).map((p) => p.code);
    let n = 0;
    const next = rows.map((p) => {
      const mine = R.filter((r) => {
        const last = order.filter((c) => r.tier.steps.includes(c)).at(-1);
        return last === p.code;
      });
      if (!mine.length) return p;
      n++;
      const a = mine[0];
      const b = mine[mine.length - 1];
      return { ...p, note: rangeText(a.from, b.to, a.prev) };
    });
    setRows(next);
    toast('info', `เติมช่วงวงเงินแล้ว ${n} ตำแหน่ง · Filled`, 'ตรวจแล้วกด “บันทึก” เพื่อใช้ · Check, then press Save');
  }
  async function remove(code: string) {
    const { ok } = await run('delete-position', sb.from('positions').delete().eq('code', code));
    if (ok) { toast('ok', 'ลบแล้ว · Deleted', code); reloadRefs(); }
  }
  return (
    <div className="card">
      <div className="actions"><h2>ตำแหน่งผู้อนุมัติ · Approver positions</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm" onClick={fillFromTiers} title="ใช้ระดับวงเงินที่บันทึกไว้ เติมช่อง “ช่วงวงเงิน” ของตำแหน่งที่อนุมัติเป็นคนสุดท้าย">เติมช่วงวงเงินจากระดับวงเงิน · Fill from tiers</button>
          <button className="btn sm" onClick={() => setRows([...rows, { code: '', th: '', en: '', sort: (rows.at(-1)?.sort || 0) + 10, note: '', sign_mode: 'online', isNew: true }])}>+ เพิ่ม · Add</button>
          <button className="btn p sm" onClick={save}>บันทึก · Save</button>
        </div>
      </div>
      <span className="note">ลำดับการอนุมัติเรียงตาม “ลำดับ” น้อยไปมาก · Approvals happen in ascending order. ผู้อนุมัติในฝ่ายเดียวกับคำขอจะถูกเลือกก่อน · An approver from the request&apos;s department is chosen first.</span>
      <span className="note">ตารางเปรียบเทียบแสดงกรอบ “ผู้อนุมัติ (1), (2), …” ทุกตำแหน่งตามลำดับนี้ · ตำแหน่งที่วงเงินไม่ถึงจะถูกขีดฆ่าเมื่ออนุมัติครบ · ตำแหน่ง “ลายเซ็นสด” ไม่ต้องอนุมัติในระบบ (การอนุมัติออนไลน์จบที่ตำแหน่งก่อนหน้า) และเว้นกรอบไว้ให้เซ็นบนกระดาษที่พิมพ์ · Every position gets a signature box; unused ones are crossed out; hand-signed positions sign the printout.</span>
      {rows.map((p, i) => (
        <div key={i} className="row" style={{ gap: 10, alignItems: 'flex-end', border: '1px solid var(--beige)', borderRadius: 10, padding: 10 }}>
          <label className="f" style={{ flex: '1 1 110px' }}>รหัส · Code<input className="in mono" value={p.code} disabled={!p.isNew} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, code: e.target.value.toLowerCase() } : x)))} /></label>
          <label className="f" style={{ flex: '3 1 200px' }}>ชื่อ (ไทย)<input className="in" value={p.th} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, th: e.target.value } : x)))} /></label>
          <label className="f" style={{ flex: '3 1 200px' }}>ชื่อ (อังกฤษ)<input className="in" value={p.en} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, en: e.target.value } : x)))} /></label>
          <label className="f" style={{ flex: '3 1 220px' }}>ช่วงวงเงิน (แสดงในตารางเปรียบเทียบ)<input className="in" value={p.note || ''} maxLength={120} placeholder="เช่น (มูลค่า 1 - 1,000,000 บาท)" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} /></label>
          <label className="f" style={{ flex: '2 1 190px' }}>วิธีลงนาม
            <select className="in" value={p.sign_mode || 'online'} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, sign_mode: e.target.value as 'online' | 'wet' } : x)))}>
              <option value="online">ลงนามในระบบ (อนุมัติออนไลน์)</option>
              <option value="wet">ลายเซ็นสด (เซ็นบนกระดาษ)</option>
            </select>
          </label>
          <label className="f" style={{ flex: '1 1 80px' }}>ลำดับ<input className="in r" inputMode="numeric" value={p.sort} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, sort: Number(e.target.value) || 0 } : x)))} /></label>
          {p.isNew ? <button className="icon-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="ลบ">✕</button>
            : <button className="btn sm d" onClick={() => remove(p.code)} title="ลบได้เมื่อไม่มีผู้ใช้หรือคำขอใช้ตำแหน่งนี้">ลบ</button>}
        </div>
      ))}
    </div>
  );
}

function Tiers() {
  const { sb, tiers, positions, run, toast, reloadRefs } = useApp();
  const [rows, setRows] = useState<TierEdit[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  useEffect(() => {
    setRows(tiers.map((t) => ({ id: t.id, label: t.label, max: t.max_amount == null ? '' : fmt(t.max_amount), steps: [...t.steps], sort: t.sort })));
    setRemoved([]);
  }, [tiers]);
  const P = [...positions].sort((a, b) => a.sort - b.sort);
  const [probe, setProbe] = useState('1,000,001');
  const ranges = tierRanges(rows.map((t, idx) => ({ ...t, idx, max: t.max.trim() === '' ? null : num(t.max) })));
  /** the approval flow of one tier, in position order; hand-signed positions are marked */
  const flow = (steps: string[]) =>
    P.filter((p) => steps.includes(p.code)).map((p) => (p.sign_mode === 'wet' ? `${p.th} (ลายเซ็นสด)` : p.th));
  const probeAmt = num(probe);
  const hit = probeAmt > 0 ? ranges.find((r) => r.to == null || probeAmt <= r.to) : undefined;

  async function save() {
    if (rows.some((t) => !t.label.trim() || !t.steps.length)) return toast('bad', 'บันทึกไม่ได้ · Not saved', 'ทุกระดับต้องมีชื่อและผู้อนุมัติอย่างน้อย 1 ตำแหน่ง · Every tier needs a label and at least one approver');
    if (!rows.some((t) => t.max.trim() === '')) toast('info', 'คำเตือน · Warning', 'ไม่มีระดับ “ไม่จำกัด” ยอดที่เกินระดับสูงสุดจะส่งไม่ได้ · No unlimited tier: amounts above the top tier cannot be sent');
    const sorted = [...rows].sort((a, b) => (a.max === '' ? Infinity : num(a.max)) - (b.max === '' ? Infinity : num(b.max)));
    const payload = sorted.map((t, i) => ({ label: t.label.trim(), max_amount: t.max.trim() === '' ? null : num(t.max), steps: P.map((p) => p.code).filter((c) => t.steps.includes(c)), sort: (i + 1) * 10, id: t.id }));
    for (const id of removed) {
      const r = await run('delete-tier', sb.from('tiers').delete().eq('id', id));
      if (!r.ok) return;
    }
    for (const t of payload) {
      const { id, ...rest } = t;
      const r = id ? await run('update-tier', sb.from('tiers').update(rest).eq('id', id)) : await run('insert-tier', sb.from('tiers').insert(rest));
      if (!r.ok) return;
    }
    toast('ok', 'บันทึกวงเงินแล้ว · Price tiers saved', 'คำขอใหม่จะใช้กฎนี้ทันที · New requests use these rules now');
    reloadRefs();
  }

  return (
    <div className="card">
      <div className="actions"><h2>ระดับวงเงิน (รวม VAT) · Price tiers incl. VAT</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm" onClick={() => setRows([...rows, { label: '', max: '', steps: [], sort: 0 }])}>+ เพิ่มระดับ · Add tier</button>
          <button className="btn p sm" onClick={save}>บันทึก · Save</button>
        </div>
      </div>
      {rows.map((t, i) => (
        <div key={t.id ?? `n${i}`} style={{ border: '1px solid var(--beige)', borderRadius: 10, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
          <label className="f" style={{ flex: '1 1 180px' }}>ชื่อระดับ · Label<input className="in" value={t.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></label>
          <label className="f" style={{ flex: '1 1 180px' }}>ไม่เกิน (บาท) · Up to — ว่าง = ไม่จำกัด
            <input className="in r" inputMode="decimal" value={t.max} placeholder="ไม่จำกัด · No limit" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} onBlur={() => t.max && setRows(rows.map((x, j) => (j === i ? { ...x, max: fmt(num(x.max)) } : x)))} />
          </label>
          <fieldset style={{ border: 'none', margin: 0, padding: 0, flex: '2 1 300px' }}>
            <legend className="note" style={{ padding: 0 }}>ผู้อนุมัติตามลำดับ · Approvers in order</legend>
            <div className="row" style={{ gap: 12 }}>
              {P.map((p) => (
                <label key={p.code} className="check">
                  <input type="checkbox" checked={t.steps.includes(p.code)} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, steps: e.target.checked ? [...x.steps, p.code] : x.steps.filter((s) => s !== p.code) } : x)))} />{p.th}
                </label>
              ))}
            </div>
          </fieldset>
          <button className="icon-btn" aria-label="ลบระดับ · Remove tier" onClick={() => { if (t.id) setRemoved([...removed, t.id]); setRows(rows.filter((_, j) => j !== i)); }}>✕</button>
          {(() => {
            const r = ranges.find((x) => x.tier.idx === i);
            const f = flow(t.steps);
            return (
              <div className="tier-flow" style={{ flexBasis: '100%' }}>
                {r && <span className="chip st-draft num">ยอด {rangeText(r.from, r.to, r.prev)} บาท</span>}
                {f.length ? (
                  <span>
                    {f.map((x, k) => <span key={k}>{k > 0 && <span aria-hidden="true"> → </span>}<b>{x}</b></span>)}
                    <span className="note"> · อนุมัติครบที่ {f[f.length - 1]}</span>
                  </span>
                ) : <span style={{ color: 'var(--bad)' }}>ยังไม่ได้เลือกผู้อนุมัติ</span>}
              </div>
            );
          })()}
        </div>
      ))}
      <span className="note">ติ๊กตำแหน่งที่ต้องอนุมัติในแต่ละระดับ ระบบส่งให้อนุมัติตามลำดับ: {P.map((p) => p.th).join(' → ')} · ระดับหนึ่งครอบคลุมยอดที่มากกว่าระดับก่อนหน้า จนถึง “ไม่เกิน” ของตัวเอง · ระบบเรียงระดับตามวงเงินให้อัตโนมัติ · Tiers are sorted by amount automatically</span>
      <div className="tier-probe">
        <label className="f" htmlFor="tier-probe" style={{ flex: '0 1 240px' }}>ทดลองยอดเงิน (รวม VAT) · Try an amount
          <input className="in r" id="tier-probe" inputMode="decimal" value={probe} onChange={(e) => setProbe(e.target.value)} onBlur={() => probeAmt > 0 && setProbe(fmt(probeAmt))} />
        </label>
        <div role="status" style={{ flex: '1 1 260px' }}>
          {!(probeAmt > 0) ? <span className="note">ใส่ยอดเงินเพื่อดูว่าใครต้องอนุมัติ</span>
            : !hit ? <span style={{ color: 'var(--bad)' }}>เกินระดับสูงสุด — ส่งคำขอไม่ได้ เพิ่มระดับ “ไม่จำกัด”</span>
            : <>ยอด <b className="num">{fmt(probeAmt)}</b> บาท อยู่ในระดับ <b>{hit.tier.label || '—'}</b> → อนุมัติตามลำดับ: <b>{flow(hit.tier.steps).join(' → ') || '—'}</b></>}
          <div className="note">ตามค่าที่แสดงบนหน้านี้ (ยังไม่ต้องกดบันทึก) · Uses the values on screen</div>
        </div>
      </div>
    </div>
  );
}

type DeptImport = { file: string; add: Department[]; upd: Department[]; same: number; errs: { row: number; msg: string }[] };
const yes = (v: unknown) => !/^(n|no|0|false|ไม่|ปิด)/i.test(String(v ?? '').trim());

function Departments() {
  const { sb, departments, run, toast, reloadRefs } = useApp();
  const [rows, setRows] = useState<(Department & { isNew?: boolean })[]>([]);
  const [pv, setPv] = useState<DeptImport | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRows(departments.map((d) => ({ ...d }))), [departments]);

  /** Excel with the current departments, ready to edit and upload back */
  async function template() {
    const { default: writeExcelFile } = await import('write-excel-file/browser');
    const head = ['รหัส (อังกฤษ)', 'ชื่อฝ่าย (ไทย)', 'ชื่อฝ่าย (อังกฤษ)', 'ลำดับ', 'ใช้งาน (Y/N)'];
    const body = departments.length
      ? departments.map((d) => [d.id, d.th, d.en, String(d.sort), d.active ? 'Y' : 'N'])
      : [['purchasing', 'ฝ่ายจัดซื้อ', 'Purchasing', '10', 'Y']];
    await writeExcelFile([head, ...body].map((r) => r.map((value) => ({ value, type: String }))), {
      columns: [{ width: 18 }, { width: 32 }, { width: 28 }, { width: 8 }, { width: 14 }],
    }).toFile('departments-template.xlsx');
  }
  async function readFile(file: File) {
    try {
      let data: unknown[][];
      if (/\.csv$/i.test(file.name)) data = file.size ? (await file.text()).split(/\r?\n/).map((l) => l.split(',')) : [];
      else {
        const { readSheet } = await import('read-excel-file/browser');
        data = (await readSheet(file)) as unknown[][];
      }
      if (!data.length) return toast('bad', 'ไฟล์ว่าง · Empty file', '');
      const hd = data[0].map((h) => String(h ?? '').trim().toLowerCase());
      const find = (re: RegExp, not?: RegExp) => hd.findIndex((h) => re.test(h) && !(not && not.test(h)));
      const iId = find(/รหัส|code|^id$/);
      const iTh = find(/ไทย|thai|^th$|^ชื่อฝ่าย$/, /รหัส|code/);
      const iEn = find(/อังกฤษ|english|^en$/, /รหัส|code/);
      const iSort = find(/ลำดับ|sort|order/);
      const iAct = find(/ใช้งาน|active/);
      if (iTh < 0) return toast('bad', 'ไม่พบคอลัมน์ชื่อฝ่าย (ไทย) · Thai name column not found', 'ใช้ไฟล์จากปุ่ม “ดาวน์โหลด Template” · Use the template');
      const cur = new Map(departments.map((d) => [d.id, d]));
      const nextCode = (taken: Map<string, number>) => {
        let i = 1;
        while (cur.has(`dept-${i}`) || taken.has(`dept-${i}`)) i++;
        return `dept-${i}`;
      };
      const seen = new Map<string, number>();
      const out: DeptImport = { file: file.name, add: [], upd: [], same: 0, errs: [] };
      data.slice(1, 1001).forEach((r, k) => {
        const row = k + 2;
        const th = String(r[iTh] ?? '').trim();
        const en = iEn > -1 && iEn !== iTh ? String(r[iEn] ?? '').trim() : '';
        let id = slug(String((iId > -1 ? r[iId] : '') ?? '') || en);
        if (!th && !id) return;
        if (!th) return out.errs.push({ row, msg: 'ไม่มีชื่อฝ่าย (ไทย) · Missing Thai name' });
        // Thai-only row: the same Thai name keeps its code, otherwise a new code dept-N
        if (!id) id = departments.find((d) => d.th === th)?.id || nextCode(seen);
        if (seen.has(id)) return out.errs.push({ row, msg: `รหัส “${id}” ซ้ำกับแถว ${seen.get(id)} · Duplicate code` });
        seen.set(id, row);
        const ex = cur.get(id);
        const sortV = iSort > -1 && String(r[iSort] ?? '').trim() !== '' ? Number(r[iSort]) || 0 : ex?.sort ?? (departments.length + out.add.length + 1) * 10;
        const rec: Department = { id, th, en: en || ex?.en || '', sort: sortV, active: iAct > -1 ? yes(r[iAct]) : true };
        if (!ex) out.add.push(rec);
        else if (ex.th !== rec.th || ex.en !== rec.en || ex.sort !== rec.sort || ex.active !== rec.active) out.upd.push(rec);
        else out.same++;
      });
      setPv(out);
    } catch (e: any) {
      toast('bad', 'อ่านไฟล์ไม่สำเร็จ · Could not read the file', e?.message || 'ใช้ไฟล์ .xlsx · Use an .xlsx file');
    }
  }
  async function doImport() {
    if (!pv) return;
    setBusy(true);
    const { ok } = await run('import-departments', sb.from('departments').upsert([...pv.add, ...pv.upd]));
    setBusy(false);
    if (ok) {
      toast('ok', 'นำเข้าฝ่ายแล้ว · Departments imported', `เพิ่ม ${pv.add.length} · แก้ไข ${pv.upd.length}`);
      setPv(null);
      reloadRefs();
    }
  }
  async function save() {
    const fixed = rows.map((d) => ({ ...d, id: d.isNew ? slug(d.id || d.en || '') : d.id }));
    if (fixed.some((d) => !d.id || !d.th.trim())) return toast('bad', 'กรอกรหัส (อังกฤษ) และชื่อฝ่ายให้ครบ · Code and Thai name required', '');
    const dup = dupCode(fixed.map((d) => d.id));
    if (dup) return toast('bad', `รหัสฝ่าย “${dup}” ซ้ำกัน · Duplicate code`, 'แก้ช่องรหัสของแถวที่เพิ่มใหม่ให้ไม่ซ้ำกับฝ่ายที่มีอยู่ แล้วกดบันทึกอีกครั้ง · Give the new row a different code');
    const { ok } = await run('save-departments', sb.from('departments').upsert(fixed.map(({ id, th, en, sort, active }) => ({ id, th: th.trim(), en: en.trim(), sort: Number(sort) || 0, active }))));
    if (ok) { toast('ok', 'บันทึกฝ่ายแล้ว · Departments saved', ''); reloadRefs(); }
  }
  return (
    <div className="card">
      <div className="actions"><h2>ฝ่าย (ฝ่ายที่ขอซื้อ) · Departments</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm" id="dept-template" onClick={template}>ดาวน์โหลด Template Excel</button>
          <label className="btn sm" style={{ cursor: 'pointer' }}>นำเข้าจาก Excel · Import
            <input type="file" id="dept-file" accept=".xlsx,.csv" className="sr" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readFile(f); }} />
          </label>
          <button className="btn sm" onClick={() => setRows([...rows, { id: '', th: '', en: '', sort: (rows.at(-1)?.sort || 0) + 10, active: true, isNew: true }])}>+ เพิ่ม · Add</button>
          <button className="btn p sm" onClick={save}>บันทึก · Save</button>
        </div>
      </div>
      <span className="note">แสดงเป็น “ฝ่ายที่ขอซื้อ” ในหัวตารางเปรียบเทียบ · Shown on the comparison sheet header. ปิดใช้งานแทนการลบ · Deactivate instead of deleting. · เพิ่มหลายฝ่ายพร้อมกัน: ดาวน์โหลด Template (มีฝ่ายปัจจุบันอยู่แล้ว) แก้หรือเพิ่มแถว แล้วกด “นำเข้าจาก Excel” — รหัสที่มีอยู่แล้วจะถูกแก้ไข รหัสใหม่จะถูกเพิ่ม · เว้นรหัสว่างได้ ระบบตั้งรหัสให้</span>
      {pv && (
        <div className="imp-pv" role="status">
          <b>{pv.file}</b>: เพิ่มใหม่ <b>{pv.add.length}</b> · แก้ไข <b>{pv.upd.length}</b> · เหมือนเดิม {pv.same}{pv.errs.length ? <> · <span style={{ color: 'var(--bad)' }}>ข้าม {pv.errs.length} แถว</span></> : null}
          {pv.add.length > 0 && <div className="note">เพิ่ม: {pv.add.map((d) => `${d.th} (${d.id})`).join(', ')}</div>}
          {pv.upd.length > 0 && <div className="note">แก้ไข: {pv.upd.map((d) => `${d.th} (${d.id})`).join(', ')}</div>}
          {pv.errs.length > 0 && <div className="note" style={{ color: 'var(--bad)' }}>{pv.errs.slice(0, 8).map((e) => `แถว ${e.row}: ${e.msg}`).join(' · ')}</div>}
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn sm" onClick={() => setPv(null)}>ยกเลิก · Cancel</button>
            <button className="btn p sm" id="dept-import" disabled={busy || !(pv.add.length + pv.upd.length)} onClick={doImport}>{busy ? 'กำลังนำเข้า…' : `นำเข้า ${pv.add.length + pv.upd.length} ฝ่าย · Import`}</button>
          </div>
        </div>
      )}
      {rows.map((d, i) => (
        <div key={i} className="row" style={{ gap: 10, alignItems: 'flex-end', border: '1px solid var(--beige)', borderRadius: 10, padding: 10 }}>
          <label className="f" style={{ flex: '1 1 120px' }}>รหัส · Code<input className="in mono" value={d.id} disabled={!d.isNew} placeholder="e.g. sales" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))} /></label>
          <label className="f" style={{ flex: '3 1 200px' }}>ชื่อ (ไทย)<input className="in" value={d.th} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, th: e.target.value } : x)))} /></label>
          <label className="f" style={{ flex: '3 1 180px' }}>ชื่อ (อังกฤษ)<input className="in" value={d.en} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, en: e.target.value } : x)))} /></label>
          <label className="f" style={{ flex: '1 1 70px' }}>ลำดับ<input className="in r" value={d.sort} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, sort: Number(e.target.value) || 0 } : x)))} /></label>
          <label className="check"><input type="checkbox" checked={d.active} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} />ใช้งาน</label>
        </div>
      ))}
    </div>
  );
}

function Companies() {
  const { sb, companies, run, toast, reloadRefs, logoUrl } = useApp();
  const [rows, setRows] = useState<(Company & { isNew?: boolean })[]>([]);
  useEffect(() => setRows(companies.map((c) => ({ ...c }))), [companies]);
  async function save() {
    const fixed = rows.map((c) => ({ ...c, id: c.isNew ? slug(c.id || c.en || '') : c.id }));
    if (fixed.some((c) => !c.id || !c.th.trim())) return toast('bad', 'กรอกรหัส (อังกฤษ) และชื่อบริษัทให้ครบ · Code and Thai name required', '');
    const dup = dupCode(fixed.map((c) => c.id));
    if (dup) return toast('bad', `รหัสบริษัท “${dup}” ซ้ำกัน · Duplicate code`, 'แก้ช่องรหัสของแถวที่เพิ่มใหม่ให้ไม่ซ้ำกับบริษัทที่มีอยู่ (เช่น trr-bio มีอยู่แล้ว) แล้วกดบันทึกอีกครั้ง · Give the new row a different code');
    const { ok } = await run('save-companies', sb.from('companies').upsert(fixed.map(({ id, th, en, initials, address, logo_path, sort, active }) => ({ id, th: th.trim(), en: en.trim(), initials: initials.trim().slice(0, 4), address: address.trim(), logo_path, sort: Number(sort) || 0, active }))));
    if (ok) { toast('ok', 'บันทึกบริษัทแล้ว · Companies saved', ''); reloadRefs(); }
  }
  async function uploadLogo(i: number, f: File) {
    const c = rows[i];
    if (c.isNew) return toast('bad', 'บันทึกบริษัทก่อน แล้วจึงอัปโหลดโลโก้ · Save the company first', '');
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type)) return toast('bad', 'ใช้ไฟล์ PNG, JPG, WEBP หรือ SVG · Use PNG/JPG/WEBP/SVG', '');
    if (f.size > 2 * 1024 * 1024) return toast('bad', 'โลโก้ต้องไม่เกิน 2 MB · Logo must be under 2 MB', '');
    const ext = f.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${c.id}/logo-${Date.now()}.${ext}`;
    const up = await run('upload-logo', sb.storage.from('logos').upload(path, f, { contentType: f.type, upsert: true }));
    if (!up.ok) return;
    const { ok } = await run('save-logo-path', sb.from('companies').update({ logo_path: path }).eq('id', c.id));
    if (ok) {
      if (c.logo_path) sb.storage.from('logos').remove([c.logo_path]);
      toast('ok', 'อัปโหลดโลโก้แล้ว · Logo uploaded', c.th);
      reloadRefs();
    }
  }
  async function removeLogo(c: Company) {
    if (!c.logo_path) return;
    await sb.storage.from('logos').remove([c.logo_path]);
    const { ok } = await run('remove-logo', sb.from('companies').update({ logo_path: null }).eq('id', c.id));
    if (ok) reloadRefs();
  }
  return (
    <div className="card">
      <div className="actions"><h2>บริษัทผู้ซื้อและหัวจดหมาย · Buyer companies & letterhead</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm" onClick={() => setRows([...rows, { id: '', th: '', en: '', initials: '', address: '', logo_path: null, sort: (rows.at(-1)?.sort || 0) + 10, active: true, isNew: true }])}>+ เพิ่ม · Add</button>
          <button className="btn p sm" onClick={save}>บันทึก · Save</button>
        </div>
      </div>
      <span className="note">บริษัทที่เปิดใช้งานแสดงเป็นช่องติ๊กในหัวตารางเปรียบเทียบ บริษัทผู้ซื้อของคำขอถูกติ๊ก ✓ และใช้โลโก้ของบริษัทนั้น · Active companies appear as tick boxes on the sheet; the buyer company is ticked and its logo used.</span>
      {rows.map((c, i) => {
        const url = logoUrl(c);
        return (
          <div key={i} style={{ border: '1px solid var(--beige)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              {url ? <img className="logo-img" src={url} alt={`โลโก้ ${c.th}`} style={{ border: '1px solid var(--beige)' }} /> : (
                <div style={{ width: 62, height: 62, borderRadius: 10, background: 'var(--brown)', color: '#fff', fontWeight: 700, fontSize: 20, display: 'grid', placeItems: 'center' }}>{c.initials || 'CO'}</div>
              )}
              <label className="btn sm" style={{ cursor: 'pointer' }}>{url ? 'เปลี่ยนโลโก้ · Change logo' : 'อัปโหลดโลโก้ · Upload logo'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadLogo(i, f); }} />
              </label>
              {url && <button className="btn sm d" onClick={() => removeLogo(c)}>ลบโลโก้</button>}
              <label className="check" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={c.active} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} />ใช้งาน · Active</label>
            </div>
            <div className="grid">
              <label className="f">รหัส · Code<input className="in mono" value={c.id} disabled={!c.isNew} placeholder="e.g. abc" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))} /></label>
              <label className="f">อักษรย่อ (เมื่อไม่มีโลโก้) · Initials<input className="in" maxLength={4} value={c.initials} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, initials: e.target.value } : x)))} /></label>
              <label className="f">ชื่อ (ไทย)<input className="in" value={c.th} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, th: e.target.value } : x)))} /></label>
              <label className="f">ชื่อ (อังกฤษ)<input className="in" value={c.en} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, en: e.target.value } : x)))} /></label>
              <label className="f span2">ที่อยู่ · Address<input className="in" value={c.address} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} /></label>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const RESET_WORD = 'ลบทั้งหมด';
/** UAT clean-up before go-live: every request, its files and history; numbering restarts. */
function ResetRequests() {
  const { sb, run, toast, refresh, bump } = useApp();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    Promise.all(['draft', 'pending', 'approved', 'rejected', 'cancelled'].map((st) =>
      sb.from('requests').select('id', { count: 'exact', head: true }).eq('status', st).then(({ count }) => [st, count || 0] as const)))
      .then((xs) => setCounts(Object.fromEntries(xs)));
  }, [sb, bump]);
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  async function paths(table: 'request_files' | 'requests') {
    const out: string[] = [];
    for (let from = 0; ; from += 1000) {
      const q = table === 'request_files'
        ? sb.from('request_files').select('path').range(from, from + 999)
        : sb.from('requests').select('letter_path').not('letter_path', 'is', null).range(from, from + 999);
      const { data } = await q;
      const rows = (data || []) as { path?: string; letter_path?: string | null }[];
      rows.forEach((r) => { const p0 = r.path || r.letter_path; if (p0) out.push(p0); });
      if (rows.length < 1000) return out;
    }
  }
  async function go() {
    if (word.trim() !== RESET_WORD) return;
    setBusy('กำลังลบไฟล์แนบ…');
    const files = await paths('request_files');
    const letters = await paths('requests');
    for (let i = 0; i < files.length; i += 100) await sb.storage.from('attachments').remove(files.slice(i, i + 100));
    for (let i = 0; i < letters.length; i += 100) await sb.storage.from('letters').remove(letters.slice(i, i + 100));
    setBusy('กำลังลบคำขอ…');
    const { ok, data } = await run<number>('admin-reset-requests', sb.rpc('admin_reset_requests', { p_confirm: word.trim() }));
    setBusy('');
    if (ok) {
      setWord('');
      toast('ok', 'ล้างข้อมูลคำขอแล้ว · Requests cleared', `ลบ ${data ?? 0} คำขอ · คำขอถัดไปเริ่มเลข 0001 ใหม่`);
      refresh();
    }
  }
  return (
    <div className="card danger-zone">
      <h2>ล้างข้อมูลทดสอบก่อน Go-Live · Clear test data</h2>
      <span className="note">ลบ<b>คำขอทุกใบ</b> (ทุกสถานะ) พร้อมไฟล์แนบ ประวัติ ขั้นตอนอนุมัติ และการแจ้งเตือนของคำขอ แล้ว<b>เริ่มเลขที่คำขอใหม่</b>จาก 0001 · ไม่ลบผู้ใช้ ลายเซ็น สินค้า และการตั้งค่า · ทำได้เฉพาะผู้ดูแลระบบ และกู้คืนไม่ได้</span>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {counts === null ? <div className="skeleton" style={{ width: 240 }} /> : (
          <>
            <span className="chip st-draft">ทั้งหมด {total}</span>
            <span className="chip st-draft">ร่าง {counts.draft}</span>
            <span className="chip st-pend">รออนุมัติ {counts.pending}</span>
            <span className="chip st-ok">อนุมัติแล้ว {counts.approved}</span>
            <span className="chip st-bad">ไม่อนุมัติ {counts.rejected}</span>
            <span className="chip st-draft">ยกเลิก {counts.cancelled}</span>
          </>
        )}
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <label className="f" htmlFor="reset-word" style={{ flex: '1 1 260px' }}>พิมพ์คำว่า <b>{RESET_WORD}</b> เพื่อยืนยัน · Type to confirm
          <input className="in" id="reset-word" value={word} autoComplete="off" onChange={(e) => setWord(e.target.value)} placeholder={RESET_WORD} />
        </label>
        <button className="btn" id="reset-go" disabled={word.trim() !== RESET_WORD || !!busy || !total} onClick={go}
          style={word.trim() === RESET_WORD && total ? { background: 'var(--bad-solid)', borderColor: 'var(--bad-solid)', color: '#fff' } : undefined}>
          {busy || `ลบคำขอทั้งหมด ${total} ใบ · Delete all`}
        </button>
      </div>
    </div>
  );
}

/** Which companies each approver signs for (empty = every company). */
function ApproverCompanies() {
  const { sb, positions, companies, tiers, run, toast, bump } = useApp();
  const [rows, setRows] = useState<Profile[] | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  useEffect(() => {
    sb.from('profiles').select('id,email,name,title,dept,roles,position,status,companies').eq('status', 'active').contains('roles', ['approver'])
      .then(({ data }) => {
        const list = ((data as Profile[]) || []).map((p) => ({ ...p, companies: p.companies || [] }));
        setRows(list);
        setSaved(Object.fromEntries(list.map((p) => [p.id, (p.companies || []).slice().sort().join(',')])));
      });
  }, [sb, bump]);
  const order = (code: string | null) => positions.find((p) => p.code === code)?.sort ?? 9999;
  const cos = companies.filter((c) => c.active);
  const list = (rows || []).slice().sort((a, b) => order(a.position) - order(b.position) || a.name.localeCompare(b.name, 'th'));
  const toggle = (id: string, co: string, on: boolean) =>
    setRows((rs) => (rs || []).map((p) => (p.id === id ? { ...p, companies: on ? [...(p.companies || []), co] : (p.companies || []).filter((x) => x !== co) } : p)));
  const changed = list.filter((p) => (p.companies || []).slice().sort().join(',') !== saved[p.id]);
  async function save() {
    for (const p of changed) {
      const { ok } = await run('save-approver-companies', sb.from('profiles').update({ companies: p.companies || [] }).eq('id', p.id));
      if (!ok) return;
    }
    toast('ok', 'บันทึกผู้อนุมัติตามบริษัทแล้ว · Saved', `${changed.length} คน · คำขอที่ส่งหลังจากนี้ใช้ค่าใหม่`);
    setSaved(Object.fromEntries(list.map((p) => [p.id, (p.companies || []).slice().sort().join(',')])));
  }
  // positions used by any tier that have nobody for a company
  const used = Array.from(new Set(tiers.flatMap((t) => t.steps)));
  const gaps = cos.flatMap((c) =>
    used.filter((pos) => !list.some((p) => p.position === pos && (!(p.companies || []).length || (p.companies || []).includes(c.id))))
      .map((pos) => `${c.th}: ไม่มี${positions.find((x) => x.code === pos)?.th || pos}`));
  return (
    <div className="card">
      <div className="actions"><h2>ผู้อนุมัติตามบริษัท · Approvers by company</h2>
        <button className="btn p sm" onClick={save} disabled={!changed.length}>บันทึก{changed.length ? ` (${changed.length})` : ''} · Save</button>
      </div>
      <span className="note">ติ๊กบริษัทที่ผู้อนุมัติแต่ละคนลงนามให้ ระบบเลือกผู้อนุมัติตามตำแหน่ง → บริษัทของคำขอ → ฝ่าย · <b>ไม่ติ๊กเลย = อนุมัติได้ทุกบริษัท</b> · คนที่ติ๊กบริษัทนั้นไว้จะถูกเลือกก่อนคนที่อนุมัติได้ทุกบริษัท</span>
      {rows === null ? <div className="skeleton" /> : !list.length ? <p className="note" style={{ margin: 0 }}>ยังไม่มีผู้อนุมัติที่ใช้งาน · No active approvers</p> : (
        <div className="tw">
          <table className="t" style={{ minWidth: 520 + cos.length * 120 }}>
            <thead>
              <tr>
                <th>ตำแหน่ง · Position</th>
                <th>ผู้อนุมัติ · Approver</th>
                {cos.map((c) => <th key={c.id} style={{ textAlign: 'center' }}>{c.th}</th>)}
                <th>ผล · Result</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>{positions.find((x) => x.code === p.position)?.th || p.position || '—'}</td>
                  <td><b style={{ fontWeight: 500 }}>{p.name || p.email}</b><div className="note">{p.title}</div></td>
                  {cos.map((c) => (
                    <td key={c.id} style={{ textAlign: 'center' }}>
                      <input type="checkbox" id={`ac-${p.id}-${c.id}`} style={{ width: 20, height: 20, accentColor: 'var(--brown)' }} checked={(p.companies || []).includes(c.id)}
                        aria-label={`${p.name} อนุมัติให้ ${c.th}`} onChange={(e) => toggle(p.id, c.id, e.target.checked)} />
                    </td>
                  ))}
                  <td className="note">{(p.companies || []).length ? `เฉพาะ ${cos.filter((c) => (p.companies || []).includes(c.id)).length} บริษัทที่ติ๊ก` : 'ทุกบริษัท'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {gaps.length > 0 && <div className="warn-box">ยังส่งคำขอไม่ได้ในบางกรณี: {gaps.join(' · ')}</div>}
    </div>
  );
}

/** Units of measure offered in every หน่วย dropdown (request items and products). */
function Units() {
  const { sb, unitRows, run, toast, reloadRefs } = useApp();
  const [rows, setRows] = useState<(UnitRow & { isNew?: boolean })[]>([]);
  useEffect(() => setRows(unitRows.map((u) => ({ ...u }))), [unitRows]);
  const upd = (i: number, patch: Partial<UnitRow>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = () => setRows([...rows, { name: '', sort: Math.max(0, ...rows.map((x) => x.sort)) + 10, active: true, isNew: true }]);
  async function save() {
    const fixed = rows.map((u) => ({ ...u, name: u.name.trim() }));
    if (fixed.some((u) => !u.name)) return toast('bad', 'กรอกชื่อหน่วยให้ครบ หรือลบแถวที่ว่าง · Enter every unit name', '');
    if (fixed.some((u) => u.name.length > 20)) return toast('bad', 'ชื่อหน่วยยาวเกิน 20 ตัวอักษร · Unit name too long', '');
    const dup = dupCode(fixed.map((u) => u.name));
    if (dup) return toast('bad', `หน่วย “${dup}” ซ้ำกัน · Duplicate unit`, 'มีหน่วยนี้อยู่แล้ว ใช้ช่อง “ใช้งาน” เปิดหน่วยเดิมแทน · This unit already exists');
    const { ok } = await run('save-units', sb.from('units').upsert(fixed.map(({ name, sort, active }) => ({ name, sort: Number(sort) || 0, active })), { onConflict: 'name' }));
    if (ok) { toast('ok', 'บันทึกหน่วยสินค้าแล้ว · Units saved', 'ใช้ได้ทันทีในช่อง “หน่วย” · Available in every unit dropdown'); reloadRefs(); }
  }
  return (
    <div className="card">
      <div className="actions"><h2>หน่วยสินค้า · Units <span className="chip st-draft">{rows.filter((u) => u.active).length} หน่วยที่ใช้งาน</span></h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm" onClick={add}>+ เพิ่มหน่วย · Add</button>
          <button className="btn p sm" onClick={save}>บันทึก · Save</button>
        </div>
      </div>
      <span className="note">รายการในช่อง “หน่วย” ของรายการสินค้าในคำขอและหน้าสินค้า เรียงตาม “ลำดับ” · ปิด “ใช้งาน” เพื่อซ่อนจากรายการ (คำขอเดิมยังแสดงหน่วยเดิม) · ผู้จัดทำพิมพ์หน่วยที่ไม่มีในรายการเองได้ที่ “+ พิมพ์หน่วยอื่น” · Units shown in every unit dropdown.</span>
      {!unitRows.length && <div className="warn-box">ยังไม่มีตารางหน่วยสินค้า — รัน SQL 0009 ใน Supabase ก่อน ระหว่างนี้ระบบใช้หน่วยพื้นฐาน · Run migration 0009 first</div>}
      <div className="unit-grid">
        {rows.map((u, i) => (
          <div key={u.isNew ? `n${i}` : u.name} className={`unit-row${u.active ? '' : ' off'}`}>
            <label className="f" style={{ flex: '2 1 90px' }}>ชื่อหน่วย
              <input className="in" id={`un-name${i}`} value={u.name} maxLength={20} disabled={!u.isNew} placeholder="เช่น ถัง" autoFocus={u.isNew && i === rows.length - 1}
                onChange={(e) => upd(i, { name: e.target.value })} />
            </label>
            <label className="f" style={{ flex: '1 1 60px' }}>ลำดับ<input className="in r" inputMode="numeric" value={u.sort} onChange={(e) => upd(i, { sort: Number(e.target.value) || 0 })} /></label>
            {u.isNew ? <button className="icon-btn" aria-label="ลบแถวนี้" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
              : <label className="check"><input type="checkbox" checked={u.active} onChange={(e) => upd(i, { active: e.target.checked })} />ใช้งาน</label>}
          </div>
        ))}
      </div>
    </div>
  );
}

type PlaceEdit = Omit<DeliveryPlace, 'id'> & { id?: number };
/** Delivery places offered in the two delivery boxes of every vendor on the comparison sheet. */
function Places() {
  const { sb, places, run, toast, reloadRefs } = useApp();
  const [rows, setRows] = useState<PlaceEdit[]>([]);
  useEffect(() => setRows(places.map((p) => ({ ...p }))), [places]);
  const upd = (i: number, patch: Partial<PlaceEdit>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  async function save() {
    const fixed = rows.map((p) => ({ ...p, name: p.name.trim() }));
    if (fixed.some((p) => !p.name)) return toast('bad', 'กรอกชื่อสถานที่ให้ครบ · Enter every place name', '');
    if (fixed.some((p) => p.name.length > 60)) return toast('bad', 'ชื่อสถานที่ยาวเกิน 60 ตัวอักษร · Name too long', '');
    const dup = dupCode(fixed.map((p) => p.name));
    if (dup) return toast('bad', `สถานที่ “${dup}” ซ้ำกัน · Duplicate place`, 'ชื่อสถานที่ต้องไม่ซ้ำกัน · Each place name must be unique');
    for (const p of fixed) {
      const row = { name: p.name, slot: p.slot === 2 ? 2 : 1, sort: Number(p.sort) || 0, active: p.active };
      const r = p.id ? await run('update-place', sb.from('delivery_places').update(row).eq('id', p.id)) : await run('insert-place', sb.from('delivery_places').insert(row));
      if (!r.ok) return reloadRefs();
    }
    toast('ok', 'บันทึกสถานที่จัดส่งแล้ว · Delivery places saved', '');
    reloadRefs();
  }
  return (
    <div className="card">
      <div className="actions"><h2>สถานที่จัดส่งสินค้า · Delivery places</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm" onClick={() => setRows([...rows, { name: '', slot: 1, sort: (rows.filter((x) => x.slot === 1).at(-1)?.sort || 0) + 10, active: true }])}>+ เพิ่ม · Add</button>
          <button className="btn p sm" onClick={save}>บันทึก · Save</button>
        </div>
      </div>
      <span className="note">ผู้ขายแต่ละรายมีช่องสถานที่จัดส่ง 2 ช่องในตารางเปรียบเทียบ ช่อง 1 ตั้งต้นเป็นโรงงาน ช่อง 2 ตั้งต้นเป็นคลัง ผู้จัดทำเลือกคำจากรายการนี้และติ๊ก ✓ ที่สถานที่ที่จัดส่ง · Each vendor has two delivery boxes; preparers pick a place from this list. ปิดใช้งานแทนการลบ · Deactivate instead of deleting.</span>
      {rows.map((p, i) => (
        <div key={p.id ?? `n${i}`} className="row" style={{ gap: 10, alignItems: 'flex-end', border: '1px solid var(--beige)', borderRadius: 10, padding: 10 }}>
          <label className="f" style={{ flex: '3 1 200px' }}>ชื่อสถานที่ · Place<input className="in" id={`pl-name${i}`} value={p.name} maxLength={60} placeholder="เช่น โรงงานTRRC" onChange={(e) => upd(i, { name: e.target.value })} /></label>
          <label className="f" style={{ flex: '2 1 160px' }}>ช่องเริ่มต้น · Box
            <select className="in" value={p.slot} onChange={(e) => upd(i, { slot: e.target.value === '2' ? 2 : 1 })}>
              <option value={1}>ช่อง 1 (โรงงาน)</option>
              <option value={2}>ช่อง 2 (คลัง)</option>
            </select>
          </label>
          <label className="f" style={{ flex: '1 1 70px' }}>ลำดับ<input className="in r" value={p.sort} onChange={(e) => upd(i, { sort: Number(e.target.value) || 0 })} /></label>
          <label className="check"><input type="checkbox" checked={p.active} onChange={(e) => upd(i, { active: e.target.checked })} />ใช้งาน</label>
        </div>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AdminGate>
      <PageHead title="ตั้งค่าระบบ" lead="Application settings — price tiers, approver positions, departments, companies, units, delivery places and letter details" />
      <Tiers />
      <Positions />
      <ApproverCompanies />
      <General />
      <Companies />
      <Departments />
      <Units />
      <Places />
      <ResetRequests />
    </AdminGate>
  );
}
