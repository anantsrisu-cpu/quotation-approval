'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from './AppProvider';
import { CoverLetter } from './CoverLetter';
import { Loading, Modal, PageHead } from './ui';
import { calcAmounts, type DraftComp } from '@/lib/calc';
import { PURP, SUBJ, SUBJ_EN, UNITS, fileSize, fmt, num } from '@/lib/format';
import type { ApproverPreview, Product, RequestFile, RequestRow, RequestStep } from '@/lib/types';

const MAX_FILE = 25 * 1024 * 1024;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.doc,.csv';

interface Draft {
  subject_type: 'stock' | 'general' | 'hire';
  sku: string;
  qty: string;
  unit: string;
  unit_price: string;
  dept: string;
  purpose: 'repair' | 'replace' | 'stock';
  buyer_id: string;
  company_id: string;
  vendor: string;
  quote_no: string;
  quote_date: string;
  details: string;
  comps: DraftComp[];
  no_comp: boolean;
  no_comp_reason: string;
  low_reason: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export function RequestForm({ draftId, copyFrom }: { draftId?: string | null; copyFrom?: string | null }) {
  const app = useApp();
  const { sb, me, settings, departments, companies, people, run, toast, deptTh } = app;
  const router = useRouter();
  const vatRate = settings?.vat_rate ?? 0.07;

  const blank = useCallback(
    (): Draft => ({
      subject_type: 'general', sku: '', qty: '1', unit: 'ชิ้น', unit_price: '',
      dept: me?.dept || departments[0]?.id || '', purpose: 'replace', buyer_id: '',
      company_id: companies.find((c) => c.active)?.id || '', vendor: '', quote_no: '', quote_date: today(),
      details: '', comps: [{ vendor: '', unit_price: '' }, { vendor: '', unit_price: '' }],
      no_comp: false, no_comp_reason: '', low_reason: '',
    }),
    [me?.dept, departments, companies],
  );

  const [id, setId] = useState<string | null>(draftId || null);
  const [no, setNo] = useState<string | null>(null);
  const [d, setD] = useState<Draft | null>(draftId || copyFrom ? null : blank());
  const [files, setFiles] = useState<RequestFile[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [skuState, setSkuState] = useState<'empty' | 'loading' | 'found' | 'missing'>('empty');
  const [suggest, setSuggest] = useState<Product[]>([]);
  const [approvers, setApprovers] = useState<ApproverPreview[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'preview' | 'send' | 'delete'>(null);
  const [message, setMessage] = useState('');
  const [tried, setTried] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // load an existing draft, or copy fields from an earlier request
  useEffect(() => {
    const src = draftId || copyFrom;
    if (!src) return;
    (async () => {
      const { data, error } = await sb.from('requests').select('*').eq('id', src).maybeSingle();
      if (error || !data) {
        toast('bad', 'ไม่พบคำขอ · Request not found', '');
        router.replace('/requests');
        return;
      }
      const r = data as RequestRow;
      if (draftId && (r.status !== 'draft' || r.preparer_id !== me?.id)) {
        router.replace(`/requests/${r.id}`);
        return;
      }
      setD({
        subject_type: r.subject_type, sku: r.sku, qty: String(r.qty || 1), unit: r.unit || 'ชิ้น',
        unit_price: r.unit_price ? fmt(r.unit_price) : '', dept: r.dept || '', purpose: r.purpose,
        buyer_id: r.buyer_id || '', company_id: r.company_id || '', vendor: r.vendor,
        quote_no: copyFrom ? '' : r.quote_no, quote_date: copyFrom ? today() : r.quote_date || today(),
        details: r.details,
        comps: (r.comparisons || []).length ? r.comparisons.map((c) => ({ vendor: c.vendor, unit_price: fmt(c.unit_price) })) : [{ vendor: '', unit_price: '' }],
        no_comp: r.no_comp, no_comp_reason: r.no_comp_reason, low_reason: r.low_reason,
      });
      if (draftId) {
        setNo(r.no);
        setMessage(r.message || '');
        const f = await sb.from('request_files').select('*').eq('request_id', r.id).order('id');
        setFiles((f.data as RequestFile[]) || []);
      }
    })();
  }, [draftId, copyFrom, sb, me?.id, router, toast]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => (x ? { ...x, [k]: v } : x));

  // SKU lookup (exact match fills the product; partial match offers suggestions)
  useEffect(() => {
    if (!d) return;
    const key = d.sku.trim().toUpperCase();
    if (!key) {
      setProduct(null);
      setSkuState('empty');
      setSuggest([]);
      return;
    }
    setSkuState('loading');
    const t = setTimeout(async () => {
      const [{ data: exact }, { data: like }] = await Promise.all([
        sb.from('products').select('*').eq('sku', key).eq('active', true).maybeSingle(),
        sb.from('products').select('*').eq('active', true).or(`sku.ilike.%${key.replace(/[%,()]/g, '')}%,name.ilike.%${d.sku.trim().replace(/[%,()]/g, '')}%`).limit(8),
      ]);
      const p = (exact as Product) || null;
      setProduct(p);
      setSkuState(p ? 'found' : 'missing');
      setSuggest(((like as Product[]) || []).filter((x) => x.sku !== key));
      if (p?.unit) setD((x) => (x && x.unit !== p.unit ? { ...x, unit: p.unit } : x));
    }, 300);
    return () => clearTimeout(t);
  }, [d?.sku, sb]); // eslint-disable-line react-hooks/exhaustive-deps

  const c = useMemo(() => calcAmounts(d?.unit_price || 0, d?.qty || 0, vatRate, d?.comps || []), [d?.unit_price, d?.qty, d?.comps, vatRate]);

  // who must approve this amount (same rule the server uses)
  useEffect(() => {
    if (!d) return;
    let stale = false; // ignore answers that arrive after a newer amount was typed
    const t = setTimeout(async () => {
      const { data } = await sb.rpc('preview_approvers', { p_total: c.total, p_dept: d.dept || null });
      if (!stale) setApprovers((data as ApproverPreview[]) || []);
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [c.total, d?.dept, sb]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d || !me) return <Loading rows={5} />;

  const missing: string[] = [];
  if (!d.sku.trim()) missing.push('กรอกรหัสสินค้า SKU · Enter a SKU');
  else if (skuState === 'missing') missing.push('ไม่พบ SKU ในรายการสินค้า · SKU not found');
  if (!(c.up > 0)) missing.push('กรอกราคาต่อหน่วย · Enter the unit price');
  if (!(c.q > 0)) missing.push('กรอกจำนวน · Enter the quantity');
  if (!d.dept) missing.push('เลือกฝ่ายที่ขอซื้อ · Choose the department');
  if (!d.vendor.trim()) missing.push('กรอกชื่อผู้ขาย · Enter the vendor');
  if (!d.buyer_id) missing.push('เลือกผู้ซื้อ · Choose the buyer');
  if (!d.company_id) missing.push('เลือกบริษัทผู้ซื้อ · Choose the buyer company');
  if (d.no_comp) {
    if (!d.no_comp_reason.trim()) missing.push('ระบุเหตุผลที่ไม่มีคู่เทียบ · Give a reason for no comparison');
  } else {
    if (!d.comps.length) missing.push('เพิ่มคู่เทียบอย่างน้อย 1 ราย หรือติ๊ก "ไม่มีคู่เทียบ" · Add a comparison or tick "No comparison"');
    else if (d.comps.some((x) => !x.vendor.trim() || !(num(x.unit_price) > 0))) missing.push('กรอกชื่อและราคาต่อหน่วยของคู่เทียบให้ครบ · Complete every comparison row');
    if (!c.lowest && !d.low_reason.trim()) missing.push('ระบุเหตุผลที่ไม่เลือกราคาต่ำสุด · Explain why not the lowest price');
  }
  if (!files.length) missing.push('แนบใบเสนอราคาอย่างน้อย 1 ไฟล์ · Attach at least one quotation file');
  approvers.forEach((a) => {
    if (!a.approver_id) missing.push(`ยังไม่มีผู้อนุมัติตำแหน่ง ${a.pos_th} ในระบบ แจ้งผู้ดูแล · No approver set up for ${a.pos_th}`);
  });

  const row = () => ({
    subject_type: d.subject_type,
    sku: d.sku.trim().toUpperCase(),
    product_name: product?.name || '',
    qty: c.q,
    unit: d.unit,
    unit_price: c.up,
    dept: d.dept || null,
    purpose: d.purpose,
    buyer_id: d.buyer_id || null,
    company_id: d.company_id || null,
    vendor: d.vendor.trim(),
    quote_no: d.quote_no.trim(),
    quote_date: d.quote_date || null,
    details: d.details,
    comparisons: d.no_comp ? [] : d.comps.map((x) => ({ vendor: x.vendor.trim(), unit_price: num(x.unit_price) })),
    no_comp: d.no_comp,
    no_comp_reason: d.no_comp ? d.no_comp_reason : '',
    low_reason: d.low_reason,
    message,
  });

  /** Insert or update the draft; returns its id. */
  async function saveDraft(silent = false): Promise<string | null> {
    if (id) {
      const { ok } = await run('save-draft', sb.from('requests').update({ ...row(), updated_at: new Date().toISOString() }).eq('id', id));
      if (ok && !silent) toast('ok', 'บันทึกร่างแล้ว · Draft saved', 'กลับมาแก้ไขได้จากหน้าคำขอของฉัน · Continue from My requests');
      return ok ? id : null;
    }
    const newId = crypto.randomUUID();
    const { ok } = await run('create-draft', sb.from('requests').insert({ id: newId, ...row() }));
    if (!ok) return null;
    setId(newId);
    if (!silent) toast('ok', 'บันทึกร่างแล้ว · Draft saved', 'กลับมาแก้ไขได้จากหน้าคำขอของฉัน · Continue from My requests');
    return newId;
  }

  async function addFiles(list: FileList | null) {
    if (!list || !list.length) return;
    const arr = Array.from(list);
    const tooBig = arr.filter((f) => f.size > MAX_FILE);
    if (tooBig.length) toast('bad', 'ไฟล์ใหญ่เกิน 25 MB · File over 25 MB', tooBig.map((f) => f.name).join(', '));
    const ok = arr.filter((f) => f.size <= MAX_FILE);
    if (!ok.length) return;
    setBusy('upload');
    const rid = id || (await saveDraft(true));
    if (!rid) {
      setBusy(null);
      return;
    }
    for (const f of ok) {
      const ext = (f.name.match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0].toLowerCase();
      const base = f.name.slice(0, f.name.length - ext.length).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'file';
      const safe = base + ext; // storage keys must be ASCII; the original name is kept in request_files.name
      const path = `${rid}/${Date.now()}-${safe}`;
      const up = await run('upload-attachment', sb.storage.from('attachments').upload(path, f, { contentType: f.type || undefined, upsert: false }));
      if (!up.ok) continue;
      const ins = await run('save-attachment-row', sb.from('request_files').insert({ request_id: rid, path, name: f.name, size: f.size, mime: f.type || '' }).select('*').single());
      if (ins.ok && ins.data) setFiles((x) => [...x, ins.data as RequestFile]);
    }
    setBusy(null);
  }

  async function removeFile(f: RequestFile) {
    const a = await run('remove-attachment', sb.storage.from('attachments').remove([f.path]));
    if (!a.ok) return;
    await run('remove-attachment-row', sb.from('request_files').delete().eq('id', f.id));
    setFiles((x) => x.filter((y) => y.id !== f.id));
  }

  async function openFile(f: RequestFile) {
    const { data } = await sb.storage.from('attachments').createSignedUrl(f.path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function send() {
    setBusy('send');
    const rid = await saveDraft(true);
    if (!rid) {
      setBusy(null);
      return;
    }
    const { ok, data } = await run<{ no: string; steps: number; first_approver: string }>('submit_request', sb.rpc('submit_request', { p_id: rid, p_message: message }));
    setBusy(null);
    if (ok && data) {
      toast('ok', 'ส่งขออนุมัติสำเร็จ · Request sent', `${data.no} ส่งถึง ${data.first_approver} (ขั้นที่ 1 จาก ${data.steps})`);
      app.refresh();
      router.push(`/requests/${rid}`);
    } else setModal(null);
  }

  async function deleteDraft() {
    if (!id) return;
    setBusy('delete');
    if (files.length) await sb.storage.from('attachments').remove(files.map((f) => f.path));
    const { ok } = await run('delete-draft', sb.from('requests').delete().eq('id', id));
    setBusy(null);
    if (ok) {
      toast('ok', 'ลบฉบับร่างแล้ว · Draft deleted', '');
      router.push('/requests');
    }
  }

  const previewRow: RequestRow = {
    id: id || 'draft', no, status: 'draft', preparer_id: me.id, subject_type: d.subject_type,
    sku: d.sku.trim().toUpperCase(), product_name: product?.name || '[ชื่อสินค้า]', qty: c.q, unit: d.unit,
    unit_price: c.up, subtotal: c.sub, vat: c.vat, total: c.total, vat_rate: vatRate, dept: d.dept, purpose: d.purpose,
    buyer_id: d.buyer_id, company_id: d.company_id, vendor: d.vendor || '[ผู้ขาย]', quote_no: d.quote_no,
    quote_date: d.quote_date, details: d.details,
    comparisons: d.no_comp ? [] : c.comps.map((x) => ({ vendor: x.vendor, unit_price: x.up, subtotal: x.sub, total: x.total, diff: x.diff })),
    no_comp: d.no_comp, no_comp_reason: d.no_comp_reason, low_reason: c.lowest ? '' : d.low_reason, message,
    tier_label: approvers[0]?.tier_label || '', current_step: 0, preparer_signature: null, created_at: new Date().toISOString(),
    submitted_at: null, step_since: null, completed_at: null, letter_path: null, letter_at: null,
  };
  const previewSteps: RequestStep[] = approvers.map((a) => ({ step_no: a.step_no, position: a.pos, approver_id: a.approver_id, status: 'waiting' }));
  const activePeople = Object.values(people).filter((p) => p.status === 'active');

  return (
    <>
      <PageHead
        title={id ? (no ? `แก้ไขคำขอ ${no}` : 'แก้ไขฉบับร่าง') : 'สร้างคำขออนุมัติใหม่'}
        lead="New approval request · เลขที่จะออกให้อัตโนมัติเมื่อส่ง · number assigned when sent"
      >
        <button className="btn o" onClick={() => setModal('preview')}>ดูตัวอย่างร่าง · Preview draft</button>
      </PageHead>

      <form className="card" noValidate onSubmit={(e) => e.preventDefault()}>
        <h2>ข้อมูลคำขอ · Request details</h2>
        <div className="grid">
          <label className="f" htmlFor="f-subj">เรื่อง · Subject <span className="req">*</span>
            <select className="in" id="f-subj" value={d.subject_type} onChange={(e) => set('subject_type', e.target.value as Draft['subject_type'])}>
              {Object.keys(SUBJ).map((k) => <option key={k} value={k}>{SUBJ[k]} · {SUBJ_EN[k]}</option>)}
            </select>
          </label>
          <label className="f" htmlFor="f-sku">รหัสสินค้า SKU <span className="req">*</span>
            <input className="in mono" id="f-sku" value={d.sku} onChange={(e) => set('sku', e.target.value)} autoComplete="off" placeholder="เช่น AC-INV-18000" list="sku-suggest" />
            <datalist id="sku-suggest">{suggest.map((p) => <option key={p.sku} value={p.sku}>{p.name}</option>)}</datalist>
          </label>
          <div className="span2" aria-live="polite">
            {skuState === 'empty' && <div className="box note">กรอก SKU แล้วชื่อสินค้าจะขึ้นมาเอง · Enter a SKU and the product name appears</div>}
            {skuState === 'loading' && <div className="box note">กำลังค้นหา… · Looking up…</div>}
            {skuState === 'found' && product && (
              <div className="ok-box"><b>✓ {product.name}</b> <span className="note">· หมวด {product.category || '—'} · หน่วย {product.unit || '—'}</span></div>
            )}
            {skuState === 'missing' && (
              <div className="bad-box">
                ไม่พบ SKU นี้ในรายการสินค้า ตรวจรหัส หรือแจ้งผู้ดูแลให้เพิ่ม · SKU not found; check it or ask the admin to add it
                {suggest.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {suggest.slice(0, 5).map((p) => (
                      <button key={p.sku} type="button" className="btn sm" onClick={() => set('sku', p.sku)}>{p.sku} · {p.name}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <label className="f" htmlFor="f-dept">ฝ่ายที่ขอซื้อ · Purchase Request Department <span className="req">*</span>
            <select className="in" id="f-dept" value={d.dept} onChange={(e) => set('dept', e.target.value)}>
              <option value="">— เลือก · Select —</option>
              {departments.filter((x) => x.active || x.id === d.dept).map((x) => <option key={x.id} value={x.id}>{x.th} · {x.en}</option>)}
            </select>
          </label>
          <label className="f" htmlFor="f-purpose">ซื้อเพื่อ · Purchase purpose <span className="req">*</span>
            <select className="in" id="f-purpose" value={d.purpose} onChange={(e) => set('purpose', e.target.value as Draft['purpose'])}>
              {Object.keys(PURP).map((k) => <option key={k} value={k}>{PURP[k]}</option>)}
            </select>
          </label>
          <label className="f" htmlFor="f-vendor">ชื่อผู้ขายที่เลือก · Selected vendor <span className="req">*</span>
            <input className="in" id="f-vendor" value={d.vendor} onChange={(e) => set('vendor', e.target.value)} />
          </label>
          <label className="f" htmlFor="f-quote">เลขที่ใบเสนอราคาผู้ขาย · Vendor quote no.
            <input className="in" id="f-quote" value={d.quote_no} onChange={(e) => set('quote_no', e.target.value)} />
          </label>
          <label className="f" htmlFor="f-qdate">วันที่ใบเสนอราคา · Quotation date
            <input className="in" type="date" id="f-qdate" value={d.quote_date} onChange={(e) => set('quote_date', e.target.value)} />
          </label>
          <label className="f" htmlFor="f-buyer">ชื่อผู้ซื้อ · Buyer name <span className="req">*</span>
            <select className="in" id="f-buyer" value={d.buyer_id} onChange={(e) => set('buyer_id', e.target.value)}>
              <option value="">— เลือกผู้ซื้อ · Select —</option>
              {activePeople.map((p) => <option key={p.id} value={p.id}>{p.name || p.email} · {deptTh(p.dept)}</option>)}
            </select>
          </label>
          <label className="f" htmlFor="f-company">ชื่อบริษัทผู้ซื้อ · Buyer company <span className="req">*</span>
            <select className="in" id="f-company" value={d.company_id} onChange={(e) => set('company_id', e.target.value)}>
              <option value="">— เลือก · Select —</option>
              {companies.filter((x) => x.active || x.id === d.company_id).map((x) => <option key={x.id} value={x.id}>{x.th}</option>)}
            </select>
            <span className="note" style={{ fontWeight: 400 }}>ชื่อและโลโก้บริษัทนี้เป็นหัวหนังสืออนุมัติ · Heads the approval letter</span>
          </label>
          <label className="f span2" htmlFor="f-details">วัตถุประสงค์ / รายละเอียด · Details
            <textarea className="in" id="f-details" value={d.details} onChange={(e) => set('details', e.target.value)} />
          </label>
        </div>

        <h2>จำนวนเงิน · Amount</h2>
        <div className="grid">
          <label className="f" htmlFor="f-up">ราคาต่อหน่วย ก่อน VAT · Unit price before VAT <span className="req">*</span>
            <input className="in r" inputMode="decimal" id="f-up" value={d.unit_price} onChange={(e) => set('unit_price', e.target.value)} onBlur={() => c.up > 0 && set('unit_price', fmt(c.up))} placeholder="0.00" />
          </label>
          <label className="f" htmlFor="f-qty">จำนวน · Quantity <span className="req">*</span>
            <input className="in r" inputMode="decimal" id="f-qty" value={d.qty} onChange={(e) => set('qty', e.target.value)} />
          </label>
          <label className="f" htmlFor="f-unit">หน่วย · Unit <span className="req">*</span>
            <select className="in" id="f-unit" value={d.unit} onChange={(e) => set('unit', e.target.value)}>
              {Array.from(new Set([...UNITS, d.unit].filter(Boolean))).map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
        </div>
        <div className="grid">
          <div className="f" style={{ fontSize: 14, fontWeight: 500 }}>มูลค่ารวม ก่อน VAT · Subtotal<div className="ro">{fmt(c.sub)}</div></div>
          <div className="f" style={{ fontSize: 14, fontWeight: 500 }}>VAT {Math.round(vatRate * 100)}%<div className="ro" style={{ fontWeight: 400 }}>{fmt(c.vat)}</div></div>
          <div className="f" style={{ fontSize: 14, fontWeight: 500 }}>ยอดรวมสุทธิ (บาท) · Net total<div className="ro" style={{ fontSize: 17 }}>{fmt(c.total)}</div></div>
        </div>
        <div className="box num" style={{ borderStyle: 'solid', borderColor: 'var(--beige)' }}>
          {fmt(c.up)} × {d.qty || 0} {d.unit} = <b>{fmt(c.sub)}</b> + VAT {fmt(c.vat)} = <b>{fmt(c.total)} บาท</b>
        </div>

        <div className="card" style={{ background: 'var(--soft)', borderColor: 'var(--tan)', padding: 16 }}>
          <div className="actions">
            <b>ผู้อนุมัติที่ต้องอนุมัติในวงเงินนี้ · Approvers for this amount</b>
            <span className="chip st-draft">{approvers[0]?.tier_label || '—'} · {approvers.length} คน</span>
          </div>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {approvers.map((a, i) => (
              <li key={a.step_no} style={{ background: '#fff', border: '1px solid var(--beige)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <span className="dot ok" style={{ width: 26, height: 26, background: 'var(--brown)' }}>{i + 1}</span>
                <span style={{ flex: '999 1 200px' }}>
                  <b>{a.approver_name || <span style={{ color: 'var(--bad)' }}>ยังไม่มีผู้อนุมัติ · Not set up</span>}</b>
                  <div className="note">{a.pos_th}</div>
                </span>
                {a.approver_id && (a.has_signature
                  ? <span className="note" style={{ color: 'var(--sage-ink)' }}>✓ มีลายเซ็น · Signature on file</span>
                  : <span className="note" style={{ color: 'var(--bad)' }}>ยังไม่มีลายเซ็น · No signature yet</span>)}
              </li>
            ))}
          </ol>
          <span className="note">อนุมัติตามลำดับ กำหนดโดยกฎวงเงิน · Approved in order; set by the admin&apos;s price-tier rules</span>
        </div>

        <h2>คู่เทียบราคา · Price comparison <span className="req">*</span></h2>
        <label className="check" style={{ border: '1px solid var(--beige)', borderRadius: 10, padding: '10px 14px' }}>
          <input type="checkbox" checked={d.no_comp} onChange={(e) => set('no_comp', e.target.checked)} />ไม่มีคู่เทียบ · No comparison quote
        </label>
        {d.no_comp ? (
          <label className="f bad-box" htmlFor="f-ncr" style={{ color: 'var(--bad)' }}>
            เหตุผลที่ไม่มีคู่เทียบ (บังคับ) · Reason for no comparison (required) <span className="req">*</span>
            <textarea className="in" id="f-ncr" value={d.no_comp_reason} onChange={(e) => set('no_comp_reason', e.target.value)} placeholder="เช่น ผู้ขายรายเดียวที่เป็นตัวแทนจำหน่าย · e.g. sole authorised distributor" />
          </label>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="ok-box" style={{ background: 'var(--soft)', borderColor: 'var(--tan)' }}>
              <b>ผู้ขายที่เลือก · Selected:</b> {d.vendor || '—'}{' '}
              <span className="num note">· {fmt(c.up)} × {d.qty} = {fmt(c.sub)} ก่อน VAT · รวม VAT {fmt(c.total)}</span>
            </div>
            <div className="actions">
              <span className="note">คู่เทียบใช้จำนวนเดียวกับด้านบน กรอกเฉพาะราคาต่อหน่วยก่อน VAT · Same quantity as above; enter each vendor&apos;s unit price</span>
              <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                <button type="button" className="icon-btn" onClick={() => set('comps', d.comps.slice(0, -1))} aria-label="ลดคู่เทียบ · Remove a vendor" disabled={!d.comps.length}>−</button>
                <b className="num">{d.comps.length}</b>
                <button type="button" className="icon-btn" style={{ background: 'var(--brown)', color: '#fff', borderColor: 'var(--brown)' }} onClick={() => set('comps', [...d.comps, { vendor: '', unit_price: '' }])} aria-label="เพิ่มคู่เทียบ · Add a vendor">+</button>
              </span>
            </div>
            {d.comps.map((x, i) => {
              const cc = c.comps[i];
              return (
                <div key={i} style={{ border: '1px solid var(--beige)', borderRadius: 10, padding: 12, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', background: '#fff' }}>
                  <label className="f" style={{ flex: '999 1 220px' }} htmlFor={`cn${i}`}>ชื่อผู้ขายคู่เทียบ {i + 1} · Vendor <span className="req">*</span>
                    <input className="in" id={`cn${i}`} value={x.vendor} onChange={(e) => set('comps', d.comps.map((y, j) => (j === i ? { ...y, vendor: e.target.value } : y)))} />
                  </label>
                  <label className="f" style={{ flex: '1 1 170px' }} htmlFor={`cu${i}`}>ราคาต่อหน่วย ก่อน VAT <span className="req">*</span>
                    <input className="in r" inputMode="decimal" id={`cu${i}`} value={x.unit_price} onChange={(e) => set('comps', d.comps.map((y, j) => (j === i ? { ...y, unit_price: e.target.value } : y)))} />
                  </label>
                  <span className="num note" style={{ flex: '1 1 200px', color: 'var(--ink-2)' }}>
                    × {d.qty} {d.unit} = <b>{fmt(cc?.sub)}</b> ก่อน VAT<br />รวม VAT <b>{fmt(cc?.total)}</b><br />
                    {cc && cc.up > 0 && (
                      <span style={{ fontWeight: 600, color: cc.diff >= 0 ? 'var(--sage-ink)' : 'var(--bad)' }}>
                        {cc.diff >= 0 ? `สูงกว่า · higher +${fmt(cc.diff)}` : `ต่ำกว่า · lower −${fmt(-cc.diff)}`}
                      </span>
                    )}
                  </span>
                  <button type="button" className="icon-btn" onClick={() => set('comps', d.comps.filter((_, j) => j !== i))} aria-label={`ลบคู่เทียบ ${i + 1} · Remove`} style={{ color: 'var(--bad)', borderColor: 'var(--bad-line)' }}>⊖</button>
                </div>
              );
            })}
            {c.lowest ? (
              c.minC != null && <div className="ok-box" style={{ color: 'var(--sage-ink)' }}>✓ ผู้ขายที่เลือกราคาต่ำสุด ถูกกว่าคู่เทียบที่ใกล้ที่สุด {fmt(c.minC - c.total)} บาท · Lowest price</div>
            ) : (
              <label className="f bad-box" htmlFor="f-low" style={{ color: 'var(--bad)' }}>
                ผู้ขายที่เลือกไม่ใช่ราคาต่ำสุด ระบุเหตุผล · Not the lowest price, give a reason <span className="req">*</span>
                <textarea className="in" id="f-low" value={d.low_reason} onChange={(e) => set('low_reason', e.target.value)} />
              </label>
            )}
          </div>
        )}

        <h2>แนบใบเสนอราคา · Attach quotation <span className="req">*</span></h2>
        <label className="box" htmlFor="f-files" style={{ textAlign: 'center', cursor: 'pointer', display: 'block' }}>
          <b>{busy === 'upload' ? 'กำลังอัปโหลด… · Uploading…' : 'เลือกไฟล์ · Choose files'}</b>
          <div className="note">PDF, JPG, PNG, Excel, Word · ไม่เกิน 25 MB ต่อไฟล์ · up to 25 MB each</div>
          <input ref={fileInput} type="file" id="f-files" multiple className="sr" accept={ACCEPT} disabled={busy === 'upload'} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </label>
        {files.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {files.map((f) => (
              <li key={f.id} className="file-row">
                <span className="chip st-draft">{(f.name.split('.').pop() || '').toUpperCase()}</span>
                <button type="button" className="link-btn nm" style={{ textAlign: 'left' }} onClick={() => openFile(f)}>{f.name}</button>
                <span className="note">{fileSize(f.size)}</span>
                <button type="button" className="icon-btn" onClick={() => removeFile(f)} aria-label={`ลบไฟล์ ${f.name} · Remove file`}>✕</button>
              </li>
            ))}
          </ul>
        )}

        <div className="box">
          <b style={{ fontSize: 13 }}>ตัวอย่างในหนังสืออนุมัติ · In the approval letter</b>
          <div style={{ fontSize: 14 }}><b>เรื่อง:</b> ขออนุมัติ{SUBJ[d.subject_type]} {product?.name || '[ชื่อสินค้า]'} {deptTh(d.dept)}</div>
          <div style={{ fontSize: 14 }}>ตามที่ {deptTh(d.dept)} ได้เสนอขออนุมัติ{SUBJ[d.subject_type]} {product?.name || '[ชื่อสินค้า]'} จำนวน {d.qty} {d.unit} เพื่อ{PURP[d.purpose]} จาก {d.vendor || '[ผู้ขาย]'}…</div>
        </div>

        {tried && missing.length > 0 && (
          <div className="bad-box" role="alert">
            <b>ยังไปขั้นถัดไปไม่ได้ · Can&apos;t continue yet</b>
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>{missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        )}

        <div className="actions" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn" disabled={!!busy} onClick={() => saveDraft()}>บันทึกร่าง · Save draft</button>
            <button type="button" className="btn o" onClick={() => setModal('preview')}>ดูตัวอย่างร่าง · Preview draft</button>
            {id && !no && <button type="button" className="btn d" disabled={!!busy} onClick={() => setModal('delete')}>ลบร่าง · Delete draft</button>}
          </div>
          <button
            type="button"
            className="btn p"
            disabled={!!busy}
            onClick={() => {
              setTried(true);
              if (missing.length) return;
              setModal('send');
            }}
          >
            ถัดไป: ตรวจผู้อนุมัติและส่ง · Next: check &amp; send →
          </button>
        </div>
      </form>

      {modal === 'preview' && (
        <Modal title="ตัวอย่างร่างหนังสืออนุมัติ · Draft preview" onClose={() => setModal(null)} wide>
          <div className="letter-wrap"><CoverLetter r={previewRow} steps={previewSteps} draft /></div>
          <span className="note">ยังแก้ไขได้ หนังสือจริงจะสร้างและล็อกเมื่ออนุมัติครบ · Still editable; the real letter is locked after final approval</span>
        </Modal>
      )}

      {modal === 'send' && (
        <Modal title="ตรวจผู้อนุมัติและส่ง · Check & send" onClose={() => setModal(null)}>
          <div className="box" style={{ borderStyle: 'solid' }}>
            <b>{SUBJ[d.subject_type]} · {product?.name}</b>
            <div className="num">ยอดรวม {fmt(c.total)} บาท · {approvers[0]?.tier_label}</div>
          </div>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {approvers.map((a) => <li key={a.step_no}>{a.approver_name} — {a.pos_th}</li>)}
          </ol>
          <label className="f" htmlFor="m-msg">ข้อความถึงผู้อนุมัติ (ไม่บังคับ) · Message
            <textarea className="in" id="m-msg" value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setModal(null)}>ย้อนกลับ · Back</button>
            <button className="btn p" disabled={busy === 'send'} onClick={send}>{busy === 'send' ? 'กำลังส่ง… · Sending…' : 'ส่งขออนุมัติ · Send for approval'}</button>
          </div>
        </Modal>
      )}

      {modal === 'delete' && (
        <Modal title="ลบฉบับร่าง · Delete draft" onClose={() => setModal(null)}>
          <p style={{ margin: 0 }}>ลบฉบับร่างนี้และไฟล์แนบทั้งหมด? ย้อนกลับไม่ได้ · Delete this draft and its files? This cannot be undone.</p>
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setModal(null)}>ไม่ลบ · Keep</button>
            <button className="btn d" disabled={busy === 'delete'} onClick={deleteDraft}>ลบฉบับร่าง · Delete</button>
          </div>
        </Modal>
      )}
    </>
  );
}
