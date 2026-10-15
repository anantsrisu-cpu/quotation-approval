'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from './AppProvider';
import { CoverLetter } from './CoverLetter';
import { Loading, Modal, PageHead } from './ui';
import { blankItem, calcItems, compPrices, itemsOf, type DraftComp, type DraftItem } from '@/lib/calc';
import { PURP, SUBJ, SUBJ_EN, UNITS, fileSize, fmt, num } from '@/lib/format';
import type { ApproverPreview, LineItem, Product, RequestFile, RequestRow, RequestStep } from '@/lib/types';

const MAX_FILE = 25 * 1024 * 1024;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.doc,.csv';

interface Draft {
  preparer_id: string;
  subject_type: 'stock' | 'general' | 'hire';
  items: DraftItem[];
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
const MAX_ITEMS = 200;
const skuKey = (s: string) => s.trim().toUpperCase();
const money = (v: number | null | undefined) => (v ? fmt(v) : '');

/** Split text copied from Excel into rows of cells (tab separated; a cell with line breaks comes in "quotes"). */
function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let quoted = false;
  const t = text.replace(/\r\n?/g, '\n');
  while (i < t.length) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch;
    i++;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

/** Rows copied from Excel: SKU · qty · unit price · previous price · description. */
function parsePasted(text: string): DraftItem[] {
  return parseTsv(text)
    .filter((c) => c[0] && !/^(sku|รหัส)/i.test(c[0]))
    .map((c) => ({ ...blankItem(), sku: skuKey(c[0]), qty: c[1] || '1', unit_price: c[2] || '', prev_price: c[3] || '', description: c.slice(4).filter(Boolean).join(' ') }));
}

export function RequestForm({ draftId, copyFrom, forUser }: { draftId?: string | null; copyFrom?: string | null; forUser?: string | null }) {
  const app = useApp();
  const { sb, me, settings, departments, companies, people, run, toast, deptTh, has, name } = app;
  const router = useRouter();
  const vatRate = settings?.vat_rate ?? 0.07;
  const isAdmin = has('admin');

  const blank = useCallback(
    (): Draft => ({
      preparer_id: forUser && has('admin') ? forUser : has('preparer') ? me?.id || '' : '',
      subject_type: 'general', items: [blankItem()],
      dept: (forUser && people[forUser]?.dept) || me?.dept || departments[0]?.id || '', purpose: 'replace', buyer_id: '',
      company_id: companies.find((c) => c.active)?.id || '', vendor: '', quote_no: '', quote_date: today(),
      details: '', comps: [{ vendor: '', prices: [''] }, { vendor: '', prices: [''] }],
      no_comp: false, no_comp_reason: '', low_reason: '',
    }),
    [me?.id, me?.dept, departments, companies, has, forUser, people],
  );

  const [id, setId] = useState<string | null>(draftId || null);
  const [no, setNo] = useState<string | null>(null);
  const [d, setD] = useState<Draft | null>(draftId || copyFrom ? null : blank());
  const [files, setFiles] = useState<RequestFile[]>([]);
  const [prods, setProds] = useState<Record<string, Product | null>>({}); // SKU → product (null = not found)
  const [active, setActive] = useState(0); // item whose SKU field is being typed
  const [suggest, setSuggest] = useState<Product[]>([]);
  const [approvers, setApprovers] = useState<ApproverPreview[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'preview' | 'send' | 'delete' | 'paste'>(null);
  const [pasteText, setPasteText] = useState('');
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
      if (draftId && (r.status !== 'draft' || (r.preparer_id !== me?.id && r.created_by !== me?.id))) {
        router.replace(`/requests/${r.id}`);
        return;
      }
      const its = itemsOf(r);
      const items: DraftItem[] = its.length
        ? its.map((it) => ({ sku: it.sku, description: it.description || '', qty: String(it.qty || 1), unit: it.unit || 'ชิ้น', unit_price: money(it.unit_price), prev_price: it.prev_price != null ? fmt(it.prev_price) : '' }))
        : [blankItem()];
      const comps: DraftComp[] = (r.comparisons || []).map((c) => {
        const ps = compPrices(c);
        return { vendor: c.vendor, prices: items.map((_, k) => money(ps[k])) };
      });
      const keepPreparer = draftId || r.preparer_id === me?.id || isAdmin;
      setD({
        preparer_id: keepPreparer ? r.preparer_id : me?.id || '',
        subject_type: r.subject_type, items, dept: r.dept || '', purpose: r.purpose,
        buyer_id: r.buyer_id || '', company_id: r.company_id || '', vendor: r.vendor,
        quote_no: copyFrom ? '' : r.quote_no, quote_date: copyFrom ? today() : r.quote_date || today(),
        details: r.details,
        comps: comps.length ? comps : [{ vendor: '', prices: items.map(() => '') }],
        no_comp: r.no_comp, no_comp_reason: r.no_comp_reason, low_reason: r.low_reason,
      });
      if (draftId) {
        setNo(r.no);
        setMessage(r.message || '');
        const f = await sb.from('request_files').select('*').eq('request_id', r.id).order('id');
        setFiles((f.data as RequestFile[]) || []);
      }
    })();
  }, [draftId, copyFrom, sb, me?.id, router, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => (x ? { ...x, [k]: v } : x));
  const setItem = (i: number, patch: Partial<DraftItem>) =>
    setD((x) => (x ? { ...x, items: x.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) } : x));
  const addItems = (list: DraftItem[], at?: number) =>
    setD((x) => {
      if (!x) return x;
      const room = MAX_ITEMS - x.items.length;
      const add = list.slice(0, Math.max(0, room));
      if (!add.length) return x;
      const pos = at ?? x.items.length;
      return {
        ...x,
        items: [...x.items.slice(0, pos), ...add, ...x.items.slice(pos)],
        comps: x.comps.map((c) => ({ ...c, prices: [...c.prices.slice(0, pos), ...add.map(() => ''), ...c.prices.slice(pos)] })),
      };
    });
  const removeItem = (i: number) =>
    setD((x) => (x && x.items.length > 1 ? { ...x, items: x.items.filter((_, j) => j !== i), comps: x.comps.map((c) => ({ ...c, prices: c.prices.filter((_, j) => j !== i) })) } : x));
  const setPrice = (ci: number, k: number, v: string) =>
    setD((x) => (x ? { ...x, comps: x.comps.map((c, j) => (j === ci ? { ...c, prices: c.prices.map((p, m) => (m === k ? v : p)) } : c)) } : x));

  // look up every SKU on the form (one query for all unknown codes)
  const skuList = (d?.items || []).map((it) => skuKey(it.sku)).filter(Boolean).join('|');
  useEffect(() => {
    const keys = Array.from(new Set(skuList.split('|').filter(Boolean))).filter((k) => !(k in prods));
    if (!keys.length) return;
    const t = setTimeout(async () => {
      const { data } = await sb.from('products').select('*').in('sku', keys).eq('active', true);
      const found = new Map(((data as Product[]) || []).map((p) => [p.sku, p]));
      setProds((m) => {
        const n = { ...m };
        keys.forEach((k) => (n[k] = found.get(k) || null));
        return n;
      });
      // take the product's unit for lines that were just looked up
      setD((x) => (x ? { ...x, items: x.items.map((it) => { const p = found.get(skuKey(it.sku)); return p?.unit && keys.includes(skuKey(it.sku)) ? { ...it, unit: p.unit } : it; }) } : x));
    }, 300);
    return () => clearTimeout(t);
  }, [skuList, sb]); // eslint-disable-line react-hooks/exhaustive-deps

  // suggestions for the SKU being typed (code or product name)
  const activeSku = d?.items[active]?.sku.trim() || '';
  useEffect(() => {
    if (!activeSku) {
      setSuggest([]);
      return;
    }
    const t = setTimeout(async () => {
      const q = activeSku.replace(/[%,()]/g, '');
      const { data } = await sb.from('products').select('*').eq('active', true).or(`sku.ilike.%${q.toUpperCase()}%,name.ilike.%${q}%`).limit(8);
      setSuggest(((data as Product[]) || []).filter((x) => x.sku !== skuKey(activeSku)));
    }, 250);
    return () => clearTimeout(t);
  }, [activeSku, sb]);

  const c = useMemo(() => calcItems(d?.items || [], vatRate, d?.comps || []), [d?.items, d?.comps, vatRate]);

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

  const prodOf = (it: DraftItem) => prods[skuKey(it.sku)];
  const nameOf = (it: DraftItem) => prodOf(it)?.name || '';
  const n = d.items.length;
  const firstName = nameOf(d.items[0]) || '[ชื่อสินค้า]';
  const summaryName = firstName + (n > 1 ? ` และอีก ${n - 1} รายการ` : '');
  const proxy = d.preparer_id !== me.id;
  const preparers = Object.values(people).filter((p) => p.status === 'active' && p.roles.includes('preparer'));

  const missing: string[] = [];
  if (!d.preparer_id) missing.push('เลือกผู้จัดทำ · Choose the preparer');
  d.items.forEach((it, i) => {
    const L = `รายการที่ ${i + 1}`;
    if (!it.sku.trim()) missing.push(`${L}: กรอกรหัสสินค้า SKU · Enter a SKU`);
    else if (prodOf(it) === null) missing.push(`${L}: ไม่พบ SKU ${skuKey(it.sku)} · SKU not found`);
    if (!(c.lines[i]?.q > 0)) missing.push(`${L}: กรอกจำนวน · Enter the quantity`);
    if (!(c.lines[i]?.up > 0)) missing.push(`${L}: กรอกราคาต่อหน่วย · Enter the unit price`);
  });
  if (!d.dept) missing.push('เลือกฝ่ายที่ขอซื้อ · Choose the department');
  if (!d.vendor.trim()) missing.push('กรอกชื่อผู้ขาย · Enter the vendor');
  if (!d.buyer_id) missing.push('เลือกผู้ซื้อ · Choose the buyer');
  if (!d.company_id) missing.push('เลือกบริษัทผู้ซื้อ · Choose the buyer company');
  if (d.no_comp) {
    if (!d.no_comp_reason.trim()) missing.push('ระบุเหตุผลที่ไม่มีคู่เทียบ · Give a reason for no comparison');
  } else {
    if (!d.comps.length) missing.push('เพิ่มคู่เทียบอย่างน้อย 1 ราย หรือติ๊ก "ไม่มีคู่เทียบ" · Add a comparison or tick "No comparison"');
    d.comps.forEach((x, i) => {
      if (!x.vendor.trim()) missing.push(`คู่เทียบ ${i + 1}: กรอกชื่อผู้ขาย · Enter the vendor name`);
      if (!c.comps[i]?.complete) missing.push(`คู่เทียบ ${i + 1}: กรอกราคาต่อหน่วยให้ครบทุกรายการ · Enter a price for every item`);
    });
    if (!c.lowest && !d.low_reason.trim()) missing.push('ระบุเหตุผลที่ไม่เลือกราคาต่ำสุด · Explain why not the lowest price');
  }
  if (!files.length) missing.push('แนบใบเสนอราคาอย่างน้อย 1 ไฟล์ · Attach at least one quotation file');
  approvers.forEach((a) => {
    if (!a.approver_id) missing.push(`ยังไม่มีผู้อนุมัติตำแหน่ง ${a.pos_th} ในระบบ แจ้งผู้ดูแล · No approver set up for ${a.pos_th}`);
  });

  const rowItems = (): LineItem[] =>
    d.items.map((it, i) => ({
      sku: skuKey(it.sku), product_name: nameOf(it), description: it.description.trim(),
      qty: c.lines[i].q, unit: it.unit, unit_price: c.lines[i].up, prev_price: c.lines[i].prev,
    }));
  const row = () => {
    const items = rowItems();
    return {
      preparer_id: d.preparer_id,
      subject_type: d.subject_type,
      items,
      // summary columns used by lists & search (the server rewrites them on submit)
      sku: Array.from(new Set(items.map((x) => x.sku).filter(Boolean))).join(', ').slice(0, 500),
      product_name: nameOf(d.items[0]) ? summaryName : '',
      qty: n === 1 ? items[0].qty : n,
      unit: n === 1 ? items[0].unit : 'รายการ',
      unit_price: n === 1 ? items[0].unit_price : 0,
      dept: d.dept || null,
      purpose: d.purpose,
      buyer_id: d.buyer_id || null,
      company_id: d.company_id || null,
      vendor: d.vendor.trim(),
      quote_no: d.quote_no.trim(),
      quote_date: d.quote_date || null,
      details: d.details,
      comparisons: d.no_comp ? [] : d.comps.map((x) => ({ vendor: x.vendor.trim(), prices: x.prices.map((p) => num(p)) })),
      no_comp: d.no_comp,
      no_comp_reason: d.no_comp ? d.no_comp_reason : '',
      low_reason: d.low_reason,
      message,
    };
  };

  /** Insert or update the draft; returns its id. */
  async function saveDraft(silent = false): Promise<string | null> {
    if (!d?.preparer_id) {
      toast('bad', 'เลือกผู้จัดทำก่อน · Choose the preparer first', '');
      return null;
    }
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
    id: id || 'draft', no, status: 'draft', preparer_id: d.preparer_id || me.id, created_by: me.id, subject_type: d.subject_type,
    items: rowItems().map((it, i) => ({ ...it, product_name: it.product_name || '[ชื่อสินค้า]', line_total: c.lines[i].line, prev_diff_pct: c.lines[i].pct })),
    sku: skuKey(d.items[0].sku), product_name: summaryName, qty: n === 1 ? c.lines[0].q : n, unit: n === 1 ? d.items[0].unit : 'รายการ',
    unit_price: n === 1 ? c.lines[0].up : 0, subtotal: c.sub, vat: c.vat, total: c.total, vat_rate: vatRate, dept: d.dept, purpose: d.purpose,
    buyer_id: d.buyer_id, company_id: d.company_id, vendor: d.vendor || '[ผู้ขาย]', quote_no: d.quote_no,
    quote_date: d.quote_date, details: d.details,
    comparisons: d.no_comp ? [] : c.comps.map((x) => ({ vendor: x.vendor, prices: x.lines.map((l) => l.up), lines: x.lines.map((l) => l.line), subtotal: x.sub, total: x.total, diff: x.diff })),
    no_comp: d.no_comp, no_comp_reason: d.no_comp_reason, low_reason: c.lowest ? '' : d.low_reason, message,
    tier_label: approvers[0]?.tier_label || '', current_step: 0, preparer_signature: null, created_at: new Date().toISOString(),
    submitted_at: null, step_since: null, completed_at: null, letter_path: null, letter_at: null,
  };
  const previewSteps: RequestStep[] = approvers.map((a) => ({ step_no: a.step_no, position: a.pos, approver_id: a.approver_id, status: 'waiting' }));
  const activePeople = Object.values(people).filter((p) => p.status === 'active');

  /** Pasting a column of numbers into one price cell fills the cells below it. */
  const pasteDown = (e: React.ClipboardEvent<HTMLInputElement>, fill: (k: number, v: string) => void, from: number) => {
    const t = e.clipboardData.getData('text');
    if (!/\n/.test(t.trim())) return;
    e.preventDefault();
    t.trim().split(/\r?\n/).forEach((v, j) => from + j < n && fill(from + j, v.split('\t')[0].trim()));
  };

  return (
    <>
      <PageHead
        title={id ? (no ? `แก้ไขคำขอ ${no}` : 'แก้ไขฉบับร่าง') : 'สร้างคำขออนุมัติใหม่'}
        lead="New approval request · เลขที่จะออกให้อัตโนมัติเมื่อส่ง · number assigned when sent"
      >
        <button className="btn o" onClick={() => setModal('preview')}>ดูตัวอย่างร่าง · Preview draft</button>
      </PageHead>

      <form className="card" noValidate onSubmit={(e) => e.preventDefault()}>
        {isAdmin && (
          <div className="box" style={{ borderStyle: 'solid', borderColor: 'var(--tan)', background: 'var(--soft)' }}>
            <label className="f" htmlFor="f-prep">ผู้จัดทำ (ผู้ดูแลร่างแทนได้) · Preparer — admins may prepare on behalf of someone <span className="req">*</span>
              <select className="in" id="f-prep" value={d.preparer_id} onChange={(e) => set('preparer_id', e.target.value)}>
                <option value="">— เลือกผู้จัดทำ · Select —</option>
                {preparers.map((p) => <option key={p.id} value={p.id}>{p.id === me.id ? `ตัวฉันเอง · Myself (${p.name || p.email})` : `${p.name || p.email} · ${deptTh(p.dept)}`}</option>)}
              </select>
              {proxy && d.preparer_id && <span className="note">หนังสืออนุมัติจะแสดง &quot;{name(d.preparer_id)}&quot; เป็นผู้จัดทำ พร้อมหมายเหตุ &quot;จัดทำแทนโดย {me.name}&quot; · The letter shows the real preparer and notes you prepared it</span>}
            </label>
          </div>
        )}

        <h2>ข้อมูลคำขอ · Request details</h2>
        <div className="grid">
          <label className="f" htmlFor="f-subj">เรื่อง · Subject <span className="req">*</span>
            <select className="in" id="f-subj" value={d.subject_type} onChange={(e) => set('subject_type', e.target.value as Draft['subject_type'])}>
              {Object.keys(SUBJ).map((k) => <option key={k} value={k}>{SUBJ[k]} · {SUBJ_EN[k]}</option>)}
            </select>
          </label>
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

        <div className="actions">
          <h2 style={{ margin: 0 }}>รายการสินค้า · Items <span className="chip st-draft">{n} รายการ</span></h2>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm" onClick={() => { setPasteText(''); setModal('paste'); }}>วางหลายรายการจาก Excel · Paste from Excel</button>
            <button type="button" className="btn sm p" disabled={n >= MAX_ITEMS} onClick={() => addItems([blankItem()])}>+ เพิ่มรายการ · Add item</button>
          </div>
        </div>
        <datalist id="sku-suggest">{suggest.map((p) => <option key={p.sku} value={p.sku}>{p.name}</option>)}</datalist>
        <ol className="items">
          {d.items.map((it, i) => {
            const L = c.lines[i];
            const p = prodOf(it);
            const key = skuKey(it.sku);
            return (
              <li key={i} className="item">
                <span className="item-no" aria-hidden="true">{i + 1}</span>
                <div className="item-body">
                  <div className="item-grid">
                    <label className="f" htmlFor={`sku${i}`}>รหัสสินค้า SKU <span className="req">*</span>
                      <input className="in mono" id={`sku${i}`} value={it.sku} list="sku-suggest" autoComplete="off" placeholder="เช่น AC-INV-18000"
                        onFocus={() => setActive(i)} onChange={(e) => { setActive(i); setItem(i, { sku: e.target.value }); }} />
                    </label>
                    <label className="f" htmlFor={`qty${i}`}>จำนวน <span className="req">*</span>
                      <input className="in r" inputMode="decimal" id={`qty${i}`} value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} />
                    </label>
                    <label className="f" htmlFor={`unit${i}`}>หน่วย
                      <select className="in" id={`unit${i}`} value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })}>
                        {Array.from(new Set([...UNITS, it.unit].filter(Boolean))).map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </label>
                    <label className="f" htmlFor={`up${i}`}>ราคา/หน่วย ก่อน VAT <span className="req">*</span>
                      <input className="in r" inputMode="decimal" id={`up${i}`} value={it.unit_price} placeholder="0.00"
                        onChange={(e) => setItem(i, { unit_price: e.target.value })} onBlur={() => L.up > 0 && setItem(i, { unit_price: fmt(L.up) })}
                        onPaste={(e) => pasteDown(e, (k, v) => setItem(k, { unit_price: v }), i)} />
                    </label>
                    <label className="f" htmlFor={`pp${i}`}>ราคาก่อนหน้า · Previous
                      <input className="in r" inputMode="decimal" id={`pp${i}`} value={it.prev_price} placeholder="ไม่บังคับ"
                        onChange={(e) => setItem(i, { prev_price: e.target.value })} onBlur={() => L.prev != null && L.prev > 0 && setItem(i, { prev_price: fmt(L.prev) })}
                        onPaste={(e) => pasteDown(e, (k, v) => setItem(k, { prev_price: v }), i)} />
                    </label>
                    <div className="f">รวม ก่อน VAT<div className="ro">{fmt(L.line)}</div></div>
                  </div>
                  <div className="item-info" aria-live="polite">
                    {!key ? <span className="note">กรอก SKU แล้วชื่อสินค้าจะขึ้นมาเอง · Enter a SKU</span>
                      : p === undefined ? <span className="note">กำลังค้นหา… · Looking up…</span>
                      : p ? <span style={{ color: 'var(--sage-ink)' }}><b>✓ {p.name}</b> <span className="note">· {p.category || '—'}</span></span>
                      : (
                        <span style={{ color: 'var(--bad)' }}>
                          ไม่พบ SKU นี้ · SKU not found
                          {active === i && suggest.slice(0, 4).map((sp) => (
                            <button key={sp.sku} type="button" className="btn sm" style={{ marginLeft: 6 }} onClick={() => setItem(i, { sku: sp.sku })}>{sp.sku} · {sp.name}</button>
                          ))}
                        </span>
                      )}
                    {L.pct != null && (
                      <span className={'chip ' + (L.pct > 0 ? 'st-bad' : 'st-ok')} title="เทียบราคาก่อนหน้า · vs previous price">
                        {L.pct > 0 ? '▲' : L.pct < 0 ? '▼' : '='} {L.pct > 0 ? '+' : ''}{L.pct.toFixed(2)}% จากราคาก่อนหน้า
                      </span>
                    )}
                  </div>
                  <label className="f" htmlFor={`desc${i}`}>คำต่อท้าย / รายละเอียดเพิ่มเติม (long text) · Description
                    <textarea className="in" id={`desc${i}`} rows={1} style={{ minHeight: 44 }} value={it.description} maxLength={4000}
                      placeholder="เช่น รุ่น สี ขนาด สเปก เงื่อนไขการติดตั้ง · model, colour, size, spec…" onChange={(e) => setItem(i, { description: e.target.value })} />
                  </label>
                </div>
                <div className="item-tools">
                  <button type="button" className="icon-btn" title="แทรกรายการด้านล่าง · Insert below" aria-label={`แทรกรายการหลังรายการที่ ${i + 1} · Insert below`} disabled={n >= MAX_ITEMS} onClick={() => addItems([blankItem(it.unit)], i + 1)}>+</button>
                  <button type="button" className="icon-btn" title="ลบรายการ · Remove" aria-label={`ลบรายการที่ ${i + 1} · Remove item`} disabled={n <= 1} onClick={() => removeItem(i)} style={{ color: 'var(--bad)', borderColor: 'var(--bad-line)' }}>✕</button>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="actions">
          <span className="note">สูงสุด {MAX_ITEMS} รายการต่อคำขอ · up to {MAX_ITEMS} items; วางตัวเลขหลายบรรทัดลงช่องราคาเพื่อเติมลงด้านล่าง · paste a column of prices to fill down</span>
          <button type="button" className="btn sm p" disabled={n >= MAX_ITEMS} onClick={() => addItems([blankItem()])}>+ เพิ่มรายการ · Add item</button>
        </div>

        <h2>จำนวนเงิน · Amount</h2>
        <div className="grid">
          <div className="f" style={{ fontSize: 14, fontWeight: 500 }}>มูลค่ารวม ก่อน VAT · Subtotal<div className="ro">{fmt(c.sub)}</div></div>
          <div className="f" style={{ fontSize: 14, fontWeight: 500 }}>VAT {Math.round(vatRate * 100)}%<div className="ro" style={{ fontWeight: 400 }}>{fmt(c.vat)}</div></div>
          <div className="f" style={{ fontSize: 14, fontWeight: 500 }}>ยอดรวมสุทธิ (บาท) · Net total<div className="ro" style={{ fontSize: 17 }}>{fmt(c.total)}</div></div>
        </div>
        <div className="box num" style={{ borderStyle: 'solid', borderColor: 'var(--beige)' }}>
          {n} รายการ = <b>{fmt(c.sub)}</b> + VAT {fmt(c.vat)} = <b>{fmt(c.total)} บาท</b>
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
            <div className="actions">
              <span className="note">กรอกราคาต่อหน่วยก่อน VAT ของผู้ขายแต่ละรายทุกรายการ ระบบคูณจำนวนและรวมยอดให้ · Enter each vendor&apos;s unit price per item; totals are calculated</span>
              <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                <button type="button" className="icon-btn" onClick={() => set('comps', d.comps.slice(0, -1))} aria-label="ลดคู่เทียบ · Remove a vendor" disabled={!d.comps.length}>−</button>
                <b className="num">{d.comps.length}</b>
                <button type="button" className="icon-btn" style={{ background: 'var(--brown)', color: '#fff', borderColor: 'var(--brown)' }} onClick={() => set('comps', [...d.comps, { vendor: '', prices: d.items.map(() => '') }])} aria-label="เพิ่มคู่เทียบ · Add a vendor">+</button>
              </span>
            </div>
            <div className="tw">
              <table className="t cmp">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <th>สินค้า · Item</th>
                    <th style={{ textAlign: 'right' }}>จำนวน</th>
                    <th className="sel" style={{ textAlign: 'right' }}>ผู้ขายที่เลือก ✓<br /><span style={{ fontWeight: 600, color: 'var(--ink)' }}>{d.vendor || '—'}</span></th>
                    {d.comps.map((x, ci) => (
                      <th key={ci}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input className="in" id={`cn${ci}`} aria-label={`ชื่อผู้ขายคู่เทียบ ${ci + 1} · Vendor`} placeholder={`คู่เทียบ ${ci + 1} · Vendor`} value={x.vendor}
                            onChange={(e) => set('comps', d.comps.map((y, j) => (j === ci ? { ...y, vendor: e.target.value } : y)))} />
                          <button type="button" className="icon-btn" style={{ width: 36, height: 36, flex: 'none', color: 'var(--bad)' }} onClick={() => set('comps', d.comps.filter((_, j) => j !== ci))} aria-label={`ลบคู่เทียบ ${ci + 1} · Remove`}>✕</button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((it, k) => (
                    <tr key={k}>
                      <td className="note">{k + 1}</td>
                      <td><span className="mono" style={{ fontSize: 12 }}>{skuKey(it.sku) || '—'}</span><br />{nameOf(it) || <span className="note">—</span>}</td>
                      <td className="num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{it.qty} {it.unit}</td>
                      <td className="num sel" style={{ textAlign: 'right' }}>{fmt(c.lines[k].up)}<div className="note">= {fmt(c.lines[k].line)}</div></td>
                      {d.comps.map((x, ci) => (
                        <td key={ci}>
                          <input className="in r" inputMode="decimal" id={`cp${ci}-${k}`} aria-label={`ราคาต่อหน่วย ${x.vendor || `คู่เทียบ ${ci + 1}`} รายการที่ ${k + 1}`} value={x.prices[k] ?? ''} placeholder="0.00"
                            onChange={(e) => setPrice(ci, k, e.target.value)}
                            onBlur={() => { const v = num(x.prices[k]); if (v > 0) setPrice(ci, k, fmt(v)); }}
                            onPaste={(e) => pasteDown(e, (m, v) => setPrice(ci, m, v), k)} />
                          <div className="note num" style={{ textAlign: 'right' }}>= {fmt(c.comps[ci]?.lines[k]?.line)}</div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>มูลค่ารวม ก่อน VAT · Subtotal</td>
                    <td className="num sel" style={{ textAlign: 'right' }}>{fmt(c.sub)}</td>
                    {c.comps.map((x, ci) => <td key={ci} className="num" style={{ textAlign: 'right' }}>{fmt(x.sub)}</td>)}
                  </tr>
                  <tr>
                    <td colSpan={3}><b>รวม VAT · Total</b></td>
                    <td className="num sel" style={{ textAlign: 'right' }}><b>{fmt(c.total)}</b></td>
                    {c.comps.map((x, ci) => <td key={ci} className="num" style={{ textAlign: 'right' }}><b>{fmt(x.total)}</b></td>)}
                  </tr>
                  <tr>
                    <td colSpan={3}>ส่วนต่างจากผู้ขายที่เลือก · Difference</td>
                    <td className="sel" style={{ textAlign: 'right' }}>—</td>
                    {c.comps.map((x, ci) => (
                      <td key={ci} className="num" style={{ textAlign: 'right', fontWeight: 600, color: !x.complete ? 'var(--muted)' : x.diff >= 0 ? 'var(--sage-ink)' : 'var(--bad)' }}>
                        {!x.complete ? 'กรอกให้ครบ' : x.diff >= 0 ? `สูงกว่า +${fmt(x.diff)}` : `ต่ำกว่า −${fmt(-x.diff)}`}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
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
          <div style={{ fontSize: 14 }}><b>เรื่อง:</b> ขออนุมัติ{SUBJ[d.subject_type]} {summaryName} {deptTh(d.dept)}</div>
          <div style={{ fontSize: 14 }}>ตามที่ {deptTh(d.dept)} ได้เสนอขออนุมัติ{SUBJ[d.subject_type]} {n > 1 ? `จำนวน ${n} รายการ` : `${firstName} จำนวน ${d.items[0].qty} ${d.items[0].unit}`} เพื่อ{PURP[d.purpose]} จาก {d.vendor || '[ผู้ขาย]'}…</div>
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
            <b>{SUBJ[d.subject_type]} · {summaryName}</b>
            {proxy && <div className="note">ผู้จัดทำ {name(d.preparer_id)} · จัดทำแทนโดย {me.name}</div>}
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

      {modal === 'paste' && (
        <Modal title="วางหลายรายการจาก Excel · Paste items from Excel" onClose={() => setModal(null)} wide>
          <p style={{ margin: 0 }}>คัดลอกแถวจาก Excel แล้ววางด้านล่าง 1 แถว = 1 รายการ เรียงคอลัมน์ดังนี้ · Copy rows from Excel, one row per item, columns in this order:</p>
          <div className="box mono" style={{ fontSize: 13 }}>SKU ⇥ จำนวน ⇥ ราคาต่อหน่วยก่อน VAT ⇥ ราคาก่อนหน้า ⇥ คำต่อท้าย</div>
          <textarea className="in mono" aria-label="ข้อมูลที่วาง · Pasted rows" style={{ minHeight: 180 }} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'AC-INV-18000\t6\t29050\t28500\tติดตั้งห้องประชุม'} />
          <span className="note">พบ {parsePasted(pasteText).length} รายการ · rows found{n + parsePasted(pasteText).length > MAX_ITEMS ? ` (เกิน ${MAX_ITEMS} รายการ จะเพิ่มเท่าที่ได้)` : ''}</span>
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setModal(null)}>ยกเลิก · Cancel</button>
            <button
              className="btn p"
              disabled={!parsePasted(pasteText).length}
              onClick={() => {
                const rows = parsePasted(pasteText);
                const onlyBlank = d.items.length === 1 && !d.items[0].sku.trim() && !d.items[0].unit_price.trim();
                if (onlyBlank) setD((x) => (x ? { ...x, items: rows.slice(0, MAX_ITEMS), comps: x.comps.map((cp) => ({ ...cp, prices: rows.slice(0, MAX_ITEMS).map(() => '') })) } : x));
                else addItems(rows);
                setModal(null);
              }}
            >
              เพิ่ม {parsePasted(pasteText).length} รายการ · Add rows
            </button>
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
