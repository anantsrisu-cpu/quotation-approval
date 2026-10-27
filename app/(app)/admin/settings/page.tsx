'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { AdminGate } from '@/components/AdminGate';
import { PageHead } from '@/components/ui';
import { fmt, num } from '@/lib/format';
import type { Company, Department, Position, Tier } from '@/lib/types';

type TierEdit = Omit<Tier, 'id' | 'max_amount'> & { id?: number; max: string };
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
/** First code used by more than one row (saving such a list fails in the database), or null. */
const dupCode = (codes: string[]) => codes.find((c, i) => c && codes.indexOf(c) !== i) ?? null;

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
  const { sb, positions, run, toast, reloadRefs } = useApp();
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
  async function remove(code: string) {
    const { ok } = await run('delete-position', sb.from('positions').delete().eq('code', code));
    if (ok) { toast('ok', 'ลบแล้ว · Deleted', code); reloadRefs(); }
  }
  return (
    <div className="card">
      <div className="actions"><h2>ตำแหน่งผู้อนุมัติ · Approver positions</h2>
        <div className="row" style={{ gap: 8 }}>
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
        </div>
      ))}
      <span className="note">ลำดับผู้อนุมัติเรียงตาม: {P.map((p) => p.th).join(' → ')} · ระบบเรียงระดับตามวงเงินให้อัตโนมัติ · Tiers are sorted by amount automatically</span>
    </div>
  );
}

function Departments() {
  const { sb, departments, run, toast, reloadRefs } = useApp();
  const [rows, setRows] = useState<(Department & { isNew?: boolean })[]>([]);
  useEffect(() => setRows(departments.map((d) => ({ ...d }))), [departments]);
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
          <button className="btn sm" onClick={() => setRows([...rows, { id: '', th: '', en: '', sort: (rows.at(-1)?.sort || 0) + 10, active: true, isNew: true }])}>+ เพิ่ม · Add</button>
          <button className="btn p sm" onClick={save}>บันทึก · Save</button>
        </div>
      </div>
      <span className="note">แสดงเป็น “ฝ่ายที่ขอซื้อ” ในหัวตารางเปรียบเทียบ · Shown on the comparison sheet header. ปิดใช้งานแทนการลบ · Deactivate instead of deleting.</span>
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

export default function SettingsPage() {
  return (
    <AdminGate>
      <PageHead title="ตั้งค่าระบบ" lead="Application settings — price tiers, approver positions, departments, companies and letter details" />
      <Tiers />
      <Positions />
      <General />
      <Companies />
      <Departments />
    </AdminGate>
  );
}
