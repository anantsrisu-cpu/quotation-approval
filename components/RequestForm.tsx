'use client';
import { downloadItemForm, readItemFile } from '@/lib/itemSheet';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from './AppProvider';
import { ApprovalDoc } from './ApprovalDoc';
import { Loading, Modal, PageHead } from './ui';
import { blankComp, blankItem, calcItems, compDiscounts, compPrices, itemsOf, parseDays, type DraftComp, type DraftItem } from '@/lib/calc';
import type { DeliverySlot } from '@/lib/types';
import { PR_EXAMPLE, PR_FORMAT, PURP, SUBJ, SUBJ_EN, fileSize, fmt, isPr, normPr, num } from '@/lib/format';
import { UnitField } from './UnitField';
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
  credit_days: string;
  lead_days: string;
  warranty: string;
  report_no: string;
  report_date: string;
  delivery: DeliverySlot[];
  quote_no: string;
  quote_date: string;
  details: string;
  comps: DraftComp[];
  no_comp: boolean;
  /** ซื้อหลายเจ้า แยกราย SKU: vendors may quote only some items */
  multi_vendor: boolean;
  no_comp_reason: string;
  low_reason: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const MAX_ITEMS = 200;
const skuKey = (s: string) => s.trim().toUpperCase();
const money = (v: number | null | undefined) => (v ? fmt(v) : '');
const normDisc = (v: string) => v.replace(/[\s,]/g, '');

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

/** Rows copied from Excel: SKU · qty · unit price · discount · previous price · description. */
function parsePasted(text: string): DraftItem[] {
  return parseTsv(text)
    .filter((c) => c[0] && !/^(sku|รหัส)/i.test(c[0]))
    .map((c) => ({ ...blankItem(), sku: skuKey(c[0]), qty: c[1] || '1', unit_price: c[2] || '', discount: c[3] || '', prev_price: c[4] || '', description: c.slice(5).filter(Boolean).join(' ') }));
}


/** stored split parts [{v, qty}] → quantities typed per vendor column */
function splitToDraft(parts: { v: number; qty: number }[]): string[] {
  const out: string[] = Array(Math.max(...parts.map((x) => x.v)) + 1).fill('');
  parts.forEach((x) => (out[x.v] = String(x.qty)));
  return out;
}

export function RequestForm({ draftId, copyFrom, forUser }: { draftId?: string | null; copyFrom?: string | null; forUser?: string | null }) {
  const app = useApp();
  const { sb, me, settings, departments, companies, people, positions, places, run, toast, deptTh, has, name } = app;
  /** the two delivery boxes of a vendor: slot 1 (โรงงาน …) and slot 2 (คลัง …), unticked */
  const blankDelivery = useCallback(
    (): DeliverySlot[] => [1, 2].map((slot) => ({ place: places.find((p) => p.slot === slot && p.active)?.name || '', on: false })),
    [places],
  );
  const router = useRouter();
  const vatRate = settings?.vat_rate ?? 0.07;
  const isAdmin = has('admin');

  const blank = useCallback(
    (): Draft => ({
      preparer_id: forUser && has('admin') ? forUser : has('preparer') ? me?.id || '' : '',
      subject_type: 'general', items: [blankItem()],
      dept: (forUser && people[forUser]?.dept) || me?.dept || departments[0]?.id || '', purpose: 'replace', buyer_id: '',
      company_id: companies.find((c) => c.active)?.id || '', vendor: '', quote_no: '', quote_date: today(),
      credit_days: '', lead_days: '', warranty: '', report_no: '', report_date: '', delivery: blankDelivery(),
      details: '', comps: [{ ...blankComp(1), delivery: blankDelivery() }, { ...blankComp(1), delivery: blankDelivery() }],
      no_comp: false, no_comp_reason: '', low_reason: '', multi_vendor: false,
    }),
    [me?.id, me?.dept, departments, companies, has, forUser, people, blankDelivery],
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
  const [pasteFile, setPasteFile] = useState('');
  const [dragging, setDragging] = useState(false);
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
        ? its.map((it) => ({ sku: it.sku, description: it.description || '', qty: String(it.qty || 1), unit: it.unit || 'ชิ้น', unit_price: money(it.unit_price), discount: it.discount || '', prev_price: it.prev_price != null ? fmt(it.prev_price) : '', prev_vendor: it.prev_vendor || '', prev_date: it.prev_date || '', brand: it.brand || '', report_no: it.report_no || '',
            // keep a ✓ only where it differs from the automatic (cheapest) one
            award: it.award != null && it.award !== it.award_auto && !it.split?.length ? it.award : null, award_reason: it.award_reason || '',
            split: it.split?.length ? splitToDraft(it.split) : null }))
        : [blankItem()];
      const comps: DraftComp[] = (r.comparisons || []).map((c) => {
        const ps = compPrices(c);
        const ds = compDiscounts(c, items.length);
        return { vendor: c.vendor, prices: items.map((_, k) => money(ps[k])), discounts: ds, credit_days: c.credit_days != null ? String(c.credit_days) : '', lead_days: c.lead_days != null ? String(c.lead_days) : '', warranty: c.warranty || '', delivery: fixDelivery(c.delivery) };
      });
      const keepPreparer = draftId || r.preparer_id === me?.id || isAdmin;
      setD({
        preparer_id: keepPreparer ? r.preparer_id : me?.id || '',
        subject_type: r.subject_type, items, dept: r.dept || '', purpose: r.purpose,
        buyer_id: r.buyer_id || '', company_id: r.company_id || '', vendor: r.vendor,
        quote_no: copyFrom ? '' : r.quote_no, quote_date: copyFrom ? today() : r.quote_date || today(),
        details: r.details,
        comps: comps.length ? comps : [{ ...blankComp(items.length), delivery: blankDelivery() }],
        delivery: fixDelivery(r.delivery),
        credit_days: r.credit_days != null ? String(r.credit_days) : '', lead_days: r.lead_days != null ? String(r.lead_days) : '', warranty: r.warranty || '',
        report_no: copyFrom ? '' : r.report_no || '', report_date: copyFrom ? '' : r.report_date || '',
        no_comp: r.no_comp, no_comp_reason: r.no_comp_reason, low_reason: r.low_reason, multi_vendor: !!r.multi_vendor,
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
  /** a vendor's delivery boxes, always two, empty places filled from the settings list */
  function fixDelivery(list?: DeliverySlot[] | null): DeliverySlot[] {
    const base = blankDelivery();
    return base.map((b, i) => ({ place: list?.[i]?.place || b.place, on: !!list?.[i]?.on }));
  }
  // the delivery place list arrives after the first render: fill boxes that are still empty
  useEffect(() => {
    if (!places.length) return;
    setD((x) => (x ? { ...x, delivery: fixDelivery(x.delivery), comps: x.comps.map((cp) => ({ ...cp, delivery: fixDelivery(cp.delivery) })) } : x));
  }, [places]); // eslint-disable-line react-hooks/exhaustive-deps
  const setDelivery = (v: number, slot: number, patch: Partial<DeliverySlot>) =>
    setD((x) => {
      if (!x) return x;
      const upd = (list: DeliverySlot[]) => fixDelivery(list).map((s0, i) => (i === slot ? { ...s0, ...patch } : s0));
      if (v === 0) return { ...x, delivery: upd(x.delivery) };
      return { ...x, comps: x.comps.map((cp, j) => (j === v - 1 ? { ...cp, delivery: upd(cp.delivery) } : cp)) };
    });
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
        comps: x.comps.map((c) => ({
          ...c,
          prices: [...c.prices.slice(0, pos), ...add.map(() => ''), ...c.prices.slice(pos)],
          discounts: [...c.discounts.slice(0, pos), ...add.map(() => ''), ...c.discounts.slice(pos)],
        })),
      };
    });
  /** an Excel form dropped on the items section or chosen in the paste window */
  async function takeItemFile(file: File) {
    try {
      const text = await readItemFile(file);
      setPasteText(text);
      setPasteFile(file.name);
      setModal('paste');
      if (!parsePasted(text).length) toast('bad', 'ไม่พบรายการในไฟล์ · No rows found', 'กรอกในชีตแรก (รายการ) เริ่มแถวที่ 2 · Fill in the first sheet from row 2');
    } catch (e: any) {
      toast('bad', 'อ่านไฟล์ไม่สำเร็จ · Could not read the file', e?.message || '');
    }
  }
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      const f = e.dataTransfer.files?.[0];
      if (!f) return;
      e.preventDefault();
      setDragging(false);
      takeItemFile(f);
    },
  };
  const removeItem = (i: number) =>
    setD((x) => (x && x.items.length > 1 ? { ...x, items: x.items.filter((_, j) => j !== i), comps: x.comps.map((c) => ({ ...c, prices: c.prices.filter((_, j) => j !== i), discounts: c.discounts.filter((_, j) => j !== i) })) } : x));
  const setPrice = (ci: number, k: number, v: string, field: 'prices' | 'discounts' = 'prices') =>
    setD((x) => (x ? { ...x, comps: x.comps.map((c, j) => (j === ci ? { ...c, [field]: c[field].map((p, m) => (m === k ? v : p)) } : c)) } : x));
  /** ซื้อหลายเจ้า on: needs vendors to compare, so "no comparison" is switched off and one vendor added */
  const setMulti = (on: boolean) =>
    setD((x) => (x ? { ...x, multi_vendor: on, ...(on ? { no_comp: false, comps: x.comps.length ? x.comps : [{ ...blankComp(x.items.length), delivery: blankDelivery() }] } : {}) } : x));
  /** แบ่งซื้อ on/off for item k */
  const toggleSplit = (k: number, on: boolean) =>
    setD((x) => (x ? { ...x, items: x.items.map((it, j) => (j === k ? { ...it, split: on ? Array(x.comps.length + 1).fill('') : null, award: null } : it)) } : x));
  const setSplitQty = (k: number, v: number, q: string) =>
    setD((x) => {
      if (!x) return x;
      return {
        ...x,
        items: x.items.map((it, j) => {
          if (j !== k || !it.split) return it;
          const sp = Array.from({ length: Math.max(it.split.length, x.comps.length + 1) }, (_, i) => it.split?.[i] ?? '');
          sp[v] = q;
          return { ...it, split: sp };
        }),
      };
    });
  /** tick ✓ vendor v for item k (back to the cheapest = automatic, no reason needed) */
  const setAward = (k: number, v: number, best: number) =>
    setD((x) => (x ? { ...x, items: x.items.map((it, j) => (j === k ? { ...it, award: v === best ? null : v } : it)) } : x));
  /** remove comparison vendor ci; ✓ that pointed at later vendors shift with them */
  const removeComp = (ci: number) =>
    setD((x) => {
      if (!x) return x;
      const v = ci + 1;
      return {
        ...x,
        comps: x.comps.filter((_, j) => j !== ci),
        items: x.items
          .map((it) => (it.split ? { ...it, split: it.split.filter((_, i) => i !== v) } : it))
          .map((it) => (it.award == null ? it : it.award === v ? { ...it, award: null, award_reason: '' } : it.award > v ? { ...it, award: it.award - 1 } : it)),
      };
    });
  const addComp = () => setD((x) => (x ? { ...x, comps: [...x.comps, { ...blankComp(x.items.length), delivery: blankDelivery() }] } : x));
  const setComp = (ci: number, patch: Partial<DraftComp>) =>
    setD((x) => (x ? { ...x, comps: x.comps.map((c, j) => (j === ci ? { ...c, ...patch } : c)) } : x));

  // look up every SKU on the form (one query for all unknown codes)
  // (0017) each buyer company has its own SKU list: the cache is per company
  const skuList = (d?.items || []).map((it) => skuKey(it.sku)).filter(Boolean).join('|');
  const coId = d?.company_id || '';
  useEffect(() => {
    if (!coId) return;
    const keys = Array.from(new Set(skuList.split('|').filter(Boolean))).filter((k) => !(`${coId}|${k}` in prods));
    if (!keys.length) return;
    const t = setTimeout(async () => {
      const { data } = await sb.from('products').select('*').eq('company_id', coId).in('sku', keys).eq('active', true);
      const found = new Map(((data as Product[]) || []).map((p) => [p.sku, p]));
      setProds((m) => {
        const n = { ...m };
        keys.forEach((k) => (n[`${coId}|${k}`] = found.get(k) || null));
        return n;
      });
      // take the product's unit for lines that were just looked up
      setD((x) => (x ? { ...x, items: x.items.map((it) => { const p = found.get(skuKey(it.sku)); return p?.unit && keys.includes(skuKey(it.sku)) ? { ...it, unit: p.unit } : it; }) } : x));
    }, 300);
    return () => clearTimeout(t);
  }, [skuList, coId, sb]); // eslint-disable-line react-hooks/exhaustive-deps

  // suggestions for the SKU being typed (code or product name)
  const activeSku = d?.items[active]?.sku.trim() || '';
  useEffect(() => {
    if (!activeSku) {
      setSuggest([]);
      return;
    }
    const t = setTimeout(async () => {
      const q = activeSku.replace(/[%,()]/g, '');
      if (!coId) return setSuggest([]);
      const { data } = await sb.from('products').select('*').eq('company_id', coId).eq('active', true).or(`sku.ilike.%${q.toUpperCase()}%,name.ilike.%${q}%`).limit(8);
      setSuggest(((data as Product[]) || []).filter((x) => x.sku !== skuKey(activeSku)));
    }, 250);
    return () => clearTimeout(t);
  }, [activeSku, coId, sb]);

  const c = useMemo(() => calcItems(d?.items || [], vatRate, d?.comps || [], !!d?.no_comp, !!d?.multi_vendor), [d?.items, d?.comps, vatRate, d?.no_comp, d?.multi_vendor]);
  // how many other requests already use this เลขที่ใบขอซื้อ (allowed, just shown as a note)
  const [rnoUsed, setRnoUsed] = useState(0);
  useEffect(() => {
    const no = d?.report_no?.trim();
    if (!no) {
      setRnoUsed(0);
      return;
    }
    const t = setTimeout(async () => {
      const { data, error } = await sb.rpc('report_no_count', { p_no: no, p_id: id || null });
      setRnoUsed(!error && typeof data === 'number' ? data : 0);
    }, 500);
    return () => clearTimeout(t);
  }, [d?.report_no, id, sb]);

  // who must approve this amount (same rule the server uses)
  useEffect(() => {
    if (!d) return;
    let stale = false; // ignore answers that arrive after a newer amount was typed
    const t = setTimeout(async () => {
      const { data } = await sb.rpc('preview_approvers', { p_total: c.total, p_dept: d.dept || null, p_company: d.company_id || null });
      if (!stale) setApprovers((data as ApproverPreview[]) || []);
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [c.total, d?.dept, d?.company_id, sb]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d || !me) return <Loading rows={5} />;

  const prodOf = (it: DraftItem) => prods[`${d.company_id}|${skuKey(it.sku)}`];
  const nameOf = (it: DraftItem) => prodOf(it)?.name || '';
  const n = d.items.length;
  const firstName = nameOf(d.items[0]) || '[ชื่อสินค้า]';
  const summaryName = firstName + (n > 1 ? ` และอีก ${n - 1} รายการ` : '');
  const proxy = d.preparer_id !== me.id;
  const preparers = Object.values(people).filter((p) => p.status === 'active' && p.roles.includes('preparer'));

  const vendorName = (v: number) => (v === 0 ? d.vendor.trim() || 'ผู้ขาย 1' : d.comps[v - 1]?.vendor.trim() || `คู่เทียบ ${v}`);
  const missing: string[] = [];
  if (!d.preparer_id) missing.push('เลือกผู้จัดทำ · Choose the preparer');
  d.items.forEach((it, i) => {
    const L = `รายการที่ ${i + 1}`;
    if (!it.sku.trim()) missing.push(`${L}: กรอกรหัสสินค้า SKU · Enter a SKU`);
    else if (prodOf(it) === null) missing.push(`${L}: ไม่พบ SKU ${skuKey(it.sku)} · SKU not found`);
    if (!(c.lines[i]?.q > 0)) missing.push(`${L}: กรอกจำนวน · Enter the quantity`);
    if (!d.multi_vendor && !(c.lines[i]?.up > 0)) missing.push(`${L}: กรอกราคาต่อหน่วย · Enter the unit price`);
    if (d.multi_vendor && !d.no_comp && c.awards[i]?.best < 0) missing.push(`${L}: ยังไม่มีผู้ขายเสนอราคา กรอกราคาอย่างน้อย 1 เจ้า · No vendor quoted this item`);
    if (c.lines[i]?.discErr) missing.push(`${L}: ${c.lines[i].discErr} · Check the discount`);
  });
  if (!d.report_no.trim()) missing.push('กรอกเลขที่ใบขอซื้อ (ใช้เป็นเลขที่คำขอ) · Enter the PR no.');
  else if (!isPr(d.report_no)) missing.push(`เลขที่ใบขอซื้อต้องเป็นรูปแบบ ${PR_FORMAT} เช่น ${PR_EXAMPLE} · PR no. format ${PR_FORMAT}`);
  d.items.forEach((it, k) => {
    if (it.report_no.trim() && !isPr(it.report_no)) missing.push(`รายการที่ ${k + 1}: เลขที่ใบขอซื้อของรายการต้องเป็นรูปแบบ ${PR_FORMAT} หรือเว้นว่าง`);
  });
  if (!d.dept) missing.push('เลือกฝ่ายที่ขอซื้อ · Choose the department');
  if (!d.vendor.trim()) missing.push('กรอกชื่อผู้ขาย · Enter the vendor');
  if (parseDays(d.credit_days).error) missing.push('เครดิต: ใส่จำนวนวันเป็นตัวเลข · Credit must be whole days');
  if (parseDays(d.lead_days).error) missing.push('Lead time: ใส่จำนวนวันเป็นตัวเลข · Lead time must be whole days');
  if (!d.buyer_id) missing.push('เลือกผู้ซื้อ · Choose the buyer');
  if (!d.company_id) missing.push('เลือกบริษัทผู้ซื้อ · Choose the buyer company');
  if (d.multi_vendor && (d.no_comp || !d.comps.length)) missing.push('ซื้อหลายเจ้า: เพิ่มผู้ขายอย่างน้อย 2 เจ้า · Add a second vendor');
  if (d.no_comp) {
    if (!d.no_comp_reason.trim()) missing.push('ระบุเหตุผลที่ไม่มีคู่เทียบ · Give a reason for no comparison');
  } else {
    if (!d.comps.length) missing.push('เพิ่มคู่เทียบอย่างน้อย 1 ราย หรือติ๊ก "ไม่มีคู่เทียบ" · Add a comparison or tick "No comparison"');
    d.comps.forEach((x, i) => {
      if (!x.vendor.trim()) missing.push(`คู่เทียบ ${i + 1}: กรอกชื่อผู้ขาย · Enter the vendor name`);
      if (!c.comps[i]?.complete)
        missing.push(d.multi_vendor
          ? `เจ้าที่ ${i + 2}: กรอกราคาอย่างน้อย 1 รายการ และตรวจส่วนลด · Enter at least one price`
          : `คู่เทียบ ${i + 1}: กรอกราคาต่อหน่วยให้ครบทุกรายการ และตรวจส่วนลด · Enter a price for every item and check discounts`);
      if (parseDays(x.credit_days).error || parseDays(x.lead_days).error) missing.push(`คู่เทียบ ${i + 1}: เครดิต / Lead time ต้องเป็นจำนวนวัน · Whole days only`);
    });
    c.awards.forEach((a, k) => {
      if (a.split && a.splitErr) missing.push(`รายการที่ ${k + 1}: แบ่งซื้อ — ${a.splitErr} · Split quantities must add up`);
      if (a.split && !d.items[k].award_reason.trim()) missing.push(`รายการที่ ${k + 1}: แบ่งซื้อหลายเจ้า ระบุเหตุผลที่สั่งซื้อ · Reason for splitting`);
      else if (a.override && !a.split && !d.items[k].award_reason.trim())
        missing.push(`รายการที่ ${k + 1}: ติ๊ก ✓ ${vendorName(a.pick)} ซึ่งไม่ใช่ราคาต่ำสุด ระบุเหตุผล · Give a reason for not buying the lowest price`);
    });
  }
  if (!files.length) missing.push('แนบใบเสนอราคาอย่างน้อย 1 ไฟล์ · Attach at least one quotation file');
  approvers.filter((a) => a.sign_mode !== 'wet').forEach((a) => {
    if (!a.approver_id) missing.push(`ยังไม่มีผู้อนุมัติตำแหน่ง ${a.pos_th} ในระบบ แจ้งผู้ดูแล · No approver set up for ${a.pos_th}`);
  });

  const rowItems = (): LineItem[] =>
    d.items.map((it, i) => ({
      sku: skuKey(it.sku), product_name: nameOf(it), description: it.description.trim(),
      qty: c.lines[i].q, unit: it.unit, unit_price: c.lines[i].up, discount: it.discount.replace(/[\s,]/g, ''), prev_price: c.lines[i].prev,
      prev_vendor: it.prev_vendor.trim(), prev_date: it.prev_date || null, brand: it.brand.trim(), report_no: it.report_no.trim(),
      // only a ✓ moved away from the cheapest vendor is stored; the server ticks the cheapest itself
      award: c.awards[i]?.override && !c.awards[i].split ? c.awards[i].pick : null,
      award_reason: c.awards[i]?.override ? it.award_reason.trim() : '',
      // แบ่งซื้อ is sent as typed (also while incomplete, so a draft keeps it)
      split: it.split && !d.no_comp ? it.split.map((q, v) => ({ v, qty: num(q) })).filter((x) => x.qty > 0) : null,
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
      unit_price: n === 1 ? c.lines[0].net : 0,
      dept: d.dept || null,
      credit_days: parseDays(d.credit_days).days,
      lead_days: parseDays(d.lead_days).days,
      warranty: d.warranty.trim(),
      report_no: d.report_no.trim(),
      report_date: d.report_date || null,
      purpose: d.purpose,
      buyer_id: d.buyer_id || null,
      company_id: d.company_id || null,
      vendor: d.vendor.trim(),
      quote_no: d.quote_no.trim(),
      quote_date: d.quote_date || null,
      details: d.details,
      comparisons: d.no_comp ? [] : d.comps.map((x) => ({
        vendor: x.vendor.trim(), prices: x.prices.map((p) => num(p)), discounts: x.discounts.map((v) => v.replace(/[\s,]/g, '')),
        credit_days: parseDays(x.credit_days).days, lead_days: parseDays(x.lead_days).days, warranty: x.warranty.trim(),
        delivery: fixDelivery(x.delivery),
      })),
      delivery: fixDelivery(d.delivery),
      no_comp: d.no_comp && !d.multi_vendor,
      multi_vendor: d.multi_vendor,
      no_comp_reason: d.no_comp ? d.no_comp_reason : '',
      low_reason: '',
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
    const { ok, data } = await run<{ no: string; steps: number; first_approver: string | null; done?: boolean }>('submit_request', sb.rpc('submit_request', { p_id: rid, p_message: message }));
    setBusy(null);
    if (ok && data) {
      toast('ok', 'ส่งขออนุมัติสำเร็จ · Request sent', data.done ? `${data.no} ผู้อนุมัติวงเงินนี้ใช้ลายเซ็นสด ดาวน์โหลด PDF ไปลงนามได้เลย` : `${data.no} ส่งถึง ${data.first_approver} (ขั้นที่ 1 จาก ${data.steps})`);
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

  const online = approvers.filter((a) => a.sign_mode !== 'wet');

  /** ✓ choice for item k in vendor column v (0 = ผู้ขายที่เลือก) */
  const tick = (k: number, v: number, a: { best: number; pick: number }) => {
    const ln = v === 0 ? c.lines[k] : c.comps[v - 1]?.lines[k];
    const usable = !!ln && ln.up > 0 && !ln.discErr;
    const on = a.pick === v;
    return (
      <label className={`award${on ? ' on' : ''}`} htmlFor={`aw${k}-${v}`}>
        <input type="radio" name={`aw${k}`} id={`aw${k}-${v}`} checked={on} disabled={!usable && !on}
          onChange={() => setAward(k, v, a.best)} />
        {on ? '✓ สั่งซื้อ' : 'เลือก'}
        {a.best === v && usable && <span className="low">ต่ำสุด</span>}
      </label>
    );
  };
  /** แบ่งซื้อ: quantity bought from vendor v for item k, with its share of the total */
  const splitCell = (k: number, v: number, a: (typeof c.awards)[number]) => {
    const part = a.split?.find((x) => x.v === v);
    const ln = v === 0 ? c.lines[k] : c.comps[v - 1]?.lines[k];
    const usable = !!ln && ln.up > 0 && !ln.discErr;
    return (
      <div className="split-in">
        <input className="in r" inputMode="decimal" id={`sq${k}-${v}`} aria-label={`จำนวนที่ซื้อจาก ${vendorName(v)} รายการที่ ${k + 1}`}
          placeholder="จำนวน" disabled={!usable && !part} value={d.items[k].split?.[v] ?? ''} onChange={(e) => setSplitQty(k, v, e.target.value)} />
        <span className="pct">{part ? `${part.pct}%` : '—'}</span>
        {part && <div className="note">= {fmt(part.line)}</div>}
      </div>
    );
  };
  /** the two delivery boxes of vendor v: tick + place chosen from the settings list */
  const deliveryCell = (v: number) => {
    const list = fixDelivery(v === 0 ? d.delivery : d.comps[v - 1]?.delivery);
    const who = vendorName(v);
    return (
      <div className="dlv">
        {list.map((sl, i) => {
          const act = places.filter((p) => p.active);
          const opts = [...act.filter((p) => p.slot === i + 1), ...act.filter((p) => p.slot !== i + 1)].map((p) => p.name);
          if (sl.place && !opts.includes(sl.place)) opts.unshift(sl.place);
          return (
            <div key={i} className="dlv-slot">
              <input type="checkbox" id={`dv${v}-${i}`} checked={sl.on} aria-label={`จัดส่งที่ ${sl.place || `ช่อง ${i + 1}`} · ${who}`}
                onChange={(e) => setDelivery(v, i, { on: e.target.checked })} />
              <select className="in" id={`dp${v}-${i}`} aria-label={`สถานที่จัดส่ง ช่อง ${i + 1} · ${who}`} value={sl.place}
                onChange={(e) => setDelivery(v, i, { place: e.target.value })}>
                <option value="">— ไม่ระบุ —</option>
                {opts.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          );
        })}
      </div>
    );
  };
  const previewRow: RequestRow = {
    id: id || 'draft', no, status: 'draft', preparer_id: d.preparer_id || me.id, created_by: me.id, subject_type: d.subject_type,
    items: rowItems().map((it, i) => ({ ...it, product_name: it.product_name || '[ชื่อสินค้า]', net_price: c.lines[i].net, line_total: c.lines[i].line, prev_diff_pct: c.lines[i].pct,
      award: c.awards[i].pick, award_auto: c.awards[i].best, award_line: c.awards[i].line, award_reason: c.awards[i].override ? d.items[i].award_reason : '',
      split: c.awards[i].split ? c.awards[i].split.map((x) => ({ v: x.v, qty: x.qty, line: x.line, pct: x.pct })) : null })),
    delivery: fixDelivery(d.delivery),
    credit_days: parseDays(d.credit_days).days, lead_days: parseDays(d.lead_days).days, warranty: d.warranty, report_no: d.report_no, report_date: d.report_date || null,
    sku: skuKey(d.items[0].sku), product_name: summaryName, qty: n === 1 ? c.lines[0].q : n, unit: n === 1 ? d.items[0].unit : 'รายการ',
    unit_price: n === 1 ? c.lines[0].net : 0, subtotal: c.sub, vat: c.vat, total: c.total, vat_rate: vatRate, dept: d.dept, purpose: d.purpose,
    buyer_id: d.buyer_id, company_id: d.company_id, vendor: d.vendor || '[ผู้ขาย]', quote_no: d.quote_no,
    quote_date: d.quote_date, details: d.details,
    comparisons: d.no_comp ? [] : c.comps.map((x, ci) => ({
      vendor: x.vendor, prices: x.lines.map((l) => l.up), discounts: d.comps[ci].discounts, nets: x.lines.map((l) => l.net),
      lines: x.lines.map((l) => l.line), subtotal: x.sub, total: x.total, diff: x.diff,
      credit_days: parseDays(d.comps[ci].credit_days).days, lead_days: parseDays(d.comps[ci].lead_days).days, warranty: d.comps[ci].warranty,
      delivery: fixDelivery(d.comps[ci].delivery),
    })),
    no_comp: d.no_comp, no_comp_reason: d.no_comp_reason, low_reason: '', message, multi_vendor: d.multi_vendor,
    sign_plan: [...positions].sort((a, b) => a.sort - b.sort).map((p) => {
      const a = approvers.find((x) => x.pos === p.code);
      if (!a) return { position: p.code, mode: 'skip' as const };
      if (a.sign_mode === 'wet') return { position: p.code, mode: 'wet' as const, approver_id: a.approver_id };
      return { position: p.code, mode: 'online' as const, step_no: online.indexOf(a) };
    }),
    tier_label: approvers[0]?.tier_label || '', current_step: 0, preparer_signature: null, created_at: new Date().toISOString(),
    submitted_at: null, step_since: null, completed_at: null, letter_path: null, letter_at: null,
  };
  const previewSteps: RequestStep[] = online.map((a, i) => ({ step_no: i, position: a.pos, approver_id: a.approver_id, status: 'waiting' }));
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
        lead="New approval request · เลขที่คำขอ = เลขที่ใบขอซื้อที่กรอก · the request number is the PR no."
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
              {proxy && d.preparer_id && <span className="note">ตารางเปรียบเทียบจะแสดง &quot;{name(d.preparer_id)}&quot; เป็นผู้จัดทำ พร้อมหมายเหตุ &quot;จัดทำแทนโดย {me.name}&quot; · The letter shows the real preparer and notes you prepared it</span>}
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
          <label className="f" htmlFor="f-vendor">{d.multi_vendor ? 'ชื่อผู้ขาย เจ้าที่ 1 · Vendor 1' : 'ชื่อผู้ขาย เจ้าที่ 1 (ใบเสนอราคาหลัก) · Main vendor'} <span className="req">*</span>
            <input className="in" id="f-vendor" value={d.vendor} onChange={(e) => set('vendor', e.target.value)} />
            <span className="check" style={{ fontWeight: 400, fontSize: 14, minHeight: 0 }}>
              <input type="checkbox" id="f-multi" checked={d.multi_vendor} onChange={(e) => setMulti(e.target.checked)} />ซื้อหลายเจ้า แยกราย SKU
            </span>
          </label>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
            <label className="f" htmlFor="f-credit">เครดิต (วัน) · Credit
              <input className="in r" inputMode="numeric" id="f-credit" value={d.credit_days} placeholder="เช่น 30" onChange={(e) => set('credit_days', e.target.value)} />
            </label>
            <label className="f" htmlFor="f-lead">Lead time (วัน)
              <input className="in r" inputMode="numeric" id="f-lead" value={d.lead_days} placeholder="เช่น 7" onChange={(e) => set('lead_days', e.target.value)} />
            </label>
          </div>
          <label className="f" htmlFor="f-warranty">การรับประกัน · Warranty
            <input className="in" id="f-warranty" value={d.warranty} maxLength={200} placeholder="เช่น 1 ปี" onChange={(e) => set('warranty', e.target.value)} />
          </label>
          <label className="f" htmlFor="f-quote">เลขที่ใบเสนอราคาผู้ขาย · Vendor quote no.
            <input className="in" id="f-quote" value={d.quote_no} onChange={(e) => set('quote_no', e.target.value)} />
          </label>
          <label className="f" htmlFor="f-rno">เลขที่ใบขอซื้อ · PR no. <span className="req">*</span>
            <input className="in mono" id="f-rno" value={d.report_no} maxLength={15} placeholder={`${PR_FORMAT} เช่น ${PR_EXAMPLE}`} aria-required="true"
              aria-invalid={!!d.report_no.trim() && !isPr(d.report_no)} aria-describedby="f-rno-help" autoCapitalize="characters" spellCheck={false}
              onChange={(e) => set('report_no', normPr(e.target.value))} />
            {d.report_no.trim() && !isPr(d.report_no)
              ? <span className="note" id="f-rno-help" style={{ fontWeight: 500, color: 'var(--bad)' }}>รูปแบบต้องเป็น {PR_FORMAT} (x = ตัวเลข, y = ตัวอักษรอังกฤษ) เช่น {PR_EXAMPLE}</span>
              : <span className="note" id="f-rno-help" style={{ fontWeight: 400 }}>รูปแบบ {PR_FORMAT} (x = ตัวเลข, y = ตัวอักษรอังกฤษ) · ใช้เป็นเลขที่คำขอ และขึ้นที่ “เลขที่ใบขอซื้อ” หัวตาราง · ใช้ซ้ำกับคำขออื่นได้</span>}
            {rnoUsed > 0 && (
              <span className="note" id="f-rno-used" style={{ fontWeight: 500, color: 'var(--ink-2)' }}>
                ℹ เลขนี้มีคำขออื่นใช้แล้ว {rnoUsed} ใบ (ใช้ซ้ำได้) · Also used on {rnoUsed} other request{rnoUsed > 1 ? 's' : ''}
              </span>
            )}
          </label>
          <label className="f" htmlFor="f-rdate">วันที่อนุมัติ (ถ้ามี) · Approval date
            <input className="in" type="date" id="f-rdate" value={d.report_date} onChange={(e) => set('report_date', e.target.value)} />
            <span className="note" style={{ fontWeight: 400 }}>ว่างไว้ = วันที่อนุมัติครบในระบบ</span>
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
            <span className="note" style={{ fontWeight: 400 }}>บริษัทนี้ถูกติ๊ก ✓ และใช้โลโก้ในหัวตารางเปรียบเทียบ · Ticked and its logo used on the sheet</span>
          </label>
          <label className="f span2" htmlFor="f-details">วัตถุประสงค์ / รายละเอียด · Details
            <textarea className="in" id="f-details" value={d.details} onChange={(e) => set('details', e.target.value)} />
          </label>
        </div>
        {d.multi_vendor && (
          <div className="multi-box">
            <div className="actions">
              <b>ผู้ขายในคำขอนี้ · Vendors ({d.comps.length + 1} เจ้า)</b>
              <button type="button" className="btn sm" id="mv-add" onClick={addComp}>+ เพิ่มผู้ขาย · Add vendor</button>
            </div>
            <span className="note">แต่ละเจ้ากรอกราคาเฉพาะรายการที่เสนอ (เว้นว่าง = ไม่ได้เสนอ) ในตารางผู้ขายด้านล่าง ระบบติ๊ก ✓ เจ้าที่ราคาต่ำสุดของแต่ละ SKU ให้ และเปลี่ยนเจ้าได้โดยระบุเหตุผล</span>
            <div className="multi-list">
              <label className="f" htmlFor="mv-0">เจ้าที่ 1<input className="in" id="mv-0" value={d.vendor} placeholder="ชื่อผู้ขาย" onChange={(e) => set('vendor', e.target.value)} /></label>
              {d.comps.map((x, ci) => (
                <label key={ci} className="f" htmlFor={`mv-${ci + 1}`}>เจ้าที่ {ci + 2}
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <input className="in" id={`mv-${ci + 1}`} value={x.vendor} placeholder="ชื่อผู้ขาย" onChange={(e) => setComp(ci, { vendor: e.target.value })} />
                    <button type="button" className="icon-btn" aria-label={`ลบเจ้าที่ ${ci + 2}`} onClick={() => removeComp(ci)}>✕</button>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className={`items-drop${dragging ? ' on' : ''}`} {...dropProps}>
        {dragging && <div className="drop-hint" aria-hidden="true">วางไฟล์ Excel ที่นี่เพื่อเพิ่มรายการ · Drop the Excel form here</div>}
        <div className="actions">
          <h2 style={{ margin: 0 }}>รายการสินค้า · Items <span className="chip st-draft">{n} รายการ</span></h2>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm" id="items-form" onClick={() => downloadItemForm()} title="ดาวน์โหลดฟอร์ม Excel ไปกรอก แล้วลากไฟล์กลับมาวางที่นี่ · Download the form, fill it in, drop it back here">⬇ ฟอร์ม Excel · Form</button>
            <button type="button" className="btn sm" onClick={() => { setPasteText(''); setPasteFile(''); setModal('paste'); }}>วางหลายรายการจาก Excel · Paste from Excel</button>
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
                      <UnitField id={`unit${i}`} value={it.unit} onChange={(v) => setItem(i, { unit: v })} />
                    </label>
                    <label className="f" htmlFor={`up${i}`}>ราคา/หน่วย <span className="req">*</span>
                      <input className="in r" inputMode="decimal" id={`up${i}`} value={it.unit_price} placeholder={d.multi_vendor ? 'ไม่ได้เสนอ' : '0.00'}
                        onChange={(e) => setItem(i, { unit_price: e.target.value })} onBlur={() => L.up > 0 && setItem(i, { unit_price: fmt(L.up) })}
                        onPaste={(e) => pasteDown(e, (k, v) => setItem(k, { unit_price: v }), i)} />
                    </label>
                    <label className="f" htmlFor={`disc${i}`}>ส่วนลด
                      <input className="in r" id={`disc${i}`} value={it.discount} placeholder="5% / 100" aria-invalid={!!L.discErr}
                        style={L.discErr ? { borderColor: 'var(--bad)' } : undefined}
                        onChange={(e) => setItem(i, { discount: e.target.value })}
                        onPaste={(e) => pasteDown(e, (k, v) => setItem(k, { discount: v }), i)} />
                    </label>
                    <div className="f">รวม (ก่อน VAT)<div className="ro">{fmt(L.line)}</div></div>
                  </div>
                  <div className="item-grid2">
                    <label className="f" htmlFor={`br${i}`}>Brand
                      <input className="in" id={`br${i}`} value={it.brand} maxLength={100} placeholder="ไม่บังคับ" onChange={(e) => setItem(i, { brand: e.target.value })} />
                    </label>
                    <label className="f" htmlFor={`pp${i}`}>ราคาประวัติเก่า/หน่วย
                      <input className="in r" inputMode="decimal" id={`pp${i}`} value={it.prev_price} placeholder="ไม่บังคับ"
                        onChange={(e) => setItem(i, { prev_price: e.target.value })} onBlur={() => L.prev != null && L.prev > 0 && setItem(i, { prev_price: fmt(L.prev) })}
                        onPaste={(e) => pasteDown(e, (k, v) => setItem(k, { prev_price: v }), i)} />
                    </label>
                    <label className="f" htmlFor={`pv${i}`}>ซื้อจากบริษัท
                      <input className="in" id={`pv${i}`} value={it.prev_vendor} maxLength={200} placeholder="ชื่อบริษัท" onChange={(e) => setItem(i, { prev_vendor: e.target.value })} />
                    </label>
                    <label className="f" htmlFor={`pd${i}`}>เมื่อ (วันที่)
                      <input className="in" type="date" id={`pd${i}`} value={it.prev_date} onChange={(e) => setItem(i, { prev_date: e.target.value })} />
                    </label>
                    <label className="f" htmlFor={`rn${i}`} title="พิมพ์ต่อท้าย Description ในตารางเปรียบเทียบ">เลขที่ใบขอซื้อ (ของรายการนี้)
                      <input className="in mono" id={`rn${i}`} value={it.report_no} maxLength={15} placeholder={`ไม่บังคับ · ${PR_FORMAT}`} autoCapitalize="characters" spellCheck={false}
                        aria-invalid={!!it.report_no.trim() && !isPr(it.report_no)} onChange={(e) => setItem(i, { report_no: normPr(e.target.value) })}
                        onPaste={(e) => pasteDown(e, (k, v) => setItem(k, { report_no: normPr(v) }), i)} />
                    </label>
                  </div>
                  <div className="item-info" aria-live="polite">
                    {!key ? <span className="note">กรอก SKU แล้วชื่อสินค้าจะขึ้นมาเอง · Enter a SKU</span>
                      : !d.company_id ? <span className="note">เลือกบริษัทผู้ซื้อก่อน ระบบจะค้นหา SKU ในรายการของบริษัทนั้น · Choose the buyer company first</span>
                      : p === undefined ? <span className="note">กำลังค้นหา… · Looking up…</span>
                      : p ? <span style={{ color: 'var(--sage-ink)' }}><b>✓ {p.name}</b> <span className="note">· {p.category || '—'}</span></span>
                      : (
                        <span style={{ color: 'var(--bad)' }}>
                          ไม่พบ SKU นี้ในรายการสินค้าของ {companies.find((x) => x.id === d.company_id)?.th || 'บริษัทที่เลือก'} · SKU not found for this company
                          {active === i && suggest.slice(0, 4).map((sp) => (
                            <button key={sp.sku} type="button" className="btn sm" style={{ marginLeft: 6 }} onClick={() => setItem(i, { sku: sp.sku })}>{sp.sku} · {sp.name}</button>
                          ))}
                        </span>
                      )}
                    {L.discErr ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>ส่วนลด: {L.discErr}</span>
                      : L.hasDisc && L.up > 0 && <span className="chip st-draft num">ราคาสุทธิ {fmt(L.net)} / {it.unit} (ลด {fmt(L.up - L.net)})</span>}
                    {L.pct != null && (
                      <span className={'chip ' + (L.pct > 0 ? 'st-bad' : 'st-ok')} title="เทียบราคาก่อนหน้า · vs previous price">
                        {L.pct > 0 ? '▲' : L.pct < 0 ? '▼' : '='} {L.pct > 0 ? '+' : ''}{L.pct.toFixed(2)}% {L.hasDisc ? 'ราคาสุทธิ' : ''}จากราคาก่อนหน้า
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
        <span className="note">มีหลายรายการ? กด “ฟอร์ม Excel” ไปกรอก แล้วลากไฟล์มาวางในส่วนนี้ · Many items? Download the form, fill it in and drop the file here.</span>
        </div>
        <div className="actions">
          <span className="note">สูงสุด {MAX_ITEMS} รายการต่อคำขอ · up to {MAX_ITEMS} items; วางตัวเลขหลายบรรทัดลงช่องราคาเพื่อเติมลงด้านล่าง · paste a column of prices to fill down</span>
          <button type="button" className="btn sm p" disabled={n >= MAX_ITEMS} onClick={() => addItems([blankItem()])}>+ เพิ่มรายการ · Add item</button>
        </div>

        <h2>จำนวนเงิน · Amount</h2>
        <div className="grid">
          <div className="f" style={{ fontSize: 14, fontWeight: 500 }}>ยอดที่ขออนุมัติ ก่อน VAT (ตามที่ติ๊ก ✓) · Subtotal<div className="ro">{fmt(c.sub)}</div></div>
          <div className="f" style={{ fontSize: 14, fontWeight: 500 }}>VAT {Math.round(vatRate * 100)}%<div className="ro" style={{ fontWeight: 400 }}>{fmt(c.vat)}</div></div>
          <div className="f" style={{ fontSize: 14, fontWeight: 500 }}>ยอดรวมสุทธิ (บาท) · Net total<div className="ro" style={{ fontSize: 17 }}>{fmt(c.total)}</div></div>
        </div>
        <div className="box num" style={{ borderStyle: 'solid', borderColor: 'var(--beige)' }}>
          {n} รายการ = <b>{fmt(c.sub)}</b> + VAT {fmt(c.vat)} = <b>{fmt(c.total)} บาท</b>
          {!d.no_comp && d.comps.length > 0 && (c.byVendor.filter((v) => v > 0).length > 1 || !(c.byVendor[0] > 0)) && (
            <div className="note" style={{ marginTop: 4 }} id="f-bought">
              สั่งซื้อจาก · Buying from: {c.byVendor.map((v, i) => (v > 0 ? `${vendorName(i)} ${fmt(v)}` : '')).filter(Boolean).join(' · ')}
              {!(c.byVendor[0] > 0) && <> · <b>ไม่ได้ซื้อจากเจ้าที่ 1</b></>}
            </div>
          )}
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
                  <b>{a.approver_name || <span style={{ color: a.sign_mode === 'wet' ? 'var(--muted)' : 'var(--bad)' }}>{a.sign_mode === 'wet' ? 'เว้นชื่อไว้ให้เขียน' : 'ยังไม่มีผู้อนุมัติ · Not set up'}</span>}</b>
                  <div className="note">{a.pos_th}</div>
                </span>
                {a.sign_mode === 'wet' ? <span className="chip st-pend">ลายเซ็นสด · เซ็นบนกระดาษหลังพิมพ์</span>
                  : a.approver_id && (a.has_signature
                  ? <span className="note" style={{ color: 'var(--sage-ink)' }}>✓ มีลายเซ็น · Signature on file</span>
                  : <span className="note" style={{ color: 'var(--bad)' }}>ยังไม่มีลายเซ็น · No signature yet</span>)}
              </li>
            ))}
          </ol>
          <span className="note">อนุมัติตามลำดับ กำหนดโดยกฎวงเงิน · ตำแหน่งที่เป็นลายเซ็นสดไม่ต้องอนุมัติในระบบ การอนุมัติออนไลน์จบที่ตำแหน่งก่อนหน้า · Hand-signed positions sign the printout instead</span>
        </div>

        <h2>คู่เทียบราคา · Price comparison <span className="req">*</span></h2>
        <label className="check" style={{ border: '1px solid var(--beige)', borderRadius: 10, padding: '10px 14px' }}>
          <input type="checkbox" checked={d.no_comp} disabled={d.multi_vendor} onChange={(e) => set('no_comp', e.target.checked)} />ไม่มีคู่เทียบ · No comparison quote
          {d.multi_vendor && <span className="note">(ใช้ไม่ได้เมื่อซื้อหลายเจ้า)</span>}
        </label>
        {d.no_comp ? (
          <label className="f bad-box" htmlFor="f-ncr" style={{ color: 'var(--bad)' }}>
            เหตุผลที่ไม่มีคู่เทียบ (บังคับ) · Reason for no comparison (required) <span className="req">*</span>
            <textarea className="in" id="f-ncr" value={d.no_comp_reason} onChange={(e) => set('no_comp_reason', e.target.value)} placeholder="เช่น ผู้ขายรายเดียวที่เป็นตัวแทนจำหน่าย · e.g. sole authorised distributor" />
          </label>
        ) : null}
        {d.no_comp ? (
          <div className="f" style={{ fontSize: 14, fontWeight: 500 }}>สถานที่จัดส่งสินค้า · Delivery{deliveryCell(0)}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="actions">
              <span className="note">กรอกราคาต่อหน่วยก่อน VAT และส่วนลด (ถ้ามี) ของผู้ขายแต่ละรายทุกรายการ ระบบคำนวณราคาสุทธิ × จำนวน และรวมยอดให้ · Enter each vendor&apos;s unit price and discount per item; net price × quantity is totalled</span>
              <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                <button type="button" className="icon-btn" onClick={() => removeComp(d.comps.length - 1)} aria-label="ลดคู่เทียบ · Remove a vendor" disabled={!d.comps.length}>−</button>
                <b className="num">{d.comps.length}</b>
                <button type="button" className="icon-btn" style={{ background: 'var(--brown)', color: '#fff', borderColor: 'var(--brown)' }} onClick={addComp} aria-label="เพิ่มคู่เทียบ · Add a vendor">+</button>
              </span>
            </div>
            <div className="tw">
              <table className="t cmp">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <th>สินค้า · Item</th>
                    <th style={{ textAlign: 'right' }}>จำนวน</th>
                    <th className="sel" style={{ textAlign: 'right' }}>{d.multi_vendor ? 'เจ้าที่ 1' : 'เจ้าที่ 1 · ผู้ขายหลัก'}<br /><span style={{ fontWeight: 600, color: 'var(--ink)' }}>{d.vendor || '—'}</span></th>
                    {d.comps.map((x, ci) => (
                      <th key={ci}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input className="in" id={`cn${ci}`} aria-label={`ชื่อผู้ขายคู่เทียบ ${ci + 1} · Vendor`} placeholder={`คู่เทียบ ${ci + 1} · Vendor`} value={x.vendor}
                            onChange={(e) => set('comps', d.comps.map((y, j) => (j === ci ? { ...y, vendor: e.target.value } : y)))} />
                          <button type="button" className="icon-btn" style={{ width: 36, height: 36, flex: 'none', color: 'var(--bad)' }} onClick={() => removeComp(ci)} aria-label={`ลบคู่เทียบ ${ci + 1} · Remove`}>✕</button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((it, k) => {
                    const a = c.awards[k];
                    return (
                    <Fragment key={k}>
                    <tr>
                      <td className="note">{k + 1}</td>
                      <td>
                        <span className="mono" style={{ fontSize: 12 }}>{skuKey(it.sku) || '—'}</span><br />{nameOf(it) || <span className="note">—</span>}
                        <div style={{ marginTop: 6 }}>
                          <button type="button" id={`sb${k}`} className={`btn sm${it.split ? ' on-split' : ''}`} aria-pressed={!!it.split} onClick={() => toggleSplit(k, !it.split)}
                            title="สั่งซื้อรายการนี้จากหลายเจ้า แบ่งจำนวนกัน">{it.split ? '✕ ยกเลิกแบ่งซื้อ' : '⇆ แบ่งซื้อ'}</button>
                        </div>
                      </td>
                      <td className="num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{it.qty} {it.unit}</td>
                      <td className={`num sel${(a.split ? a.split.some((x) => x.v === 0) : a.pick === 0) ? ' won' : ''}`} style={{ textAlign: 'right' }}>
                        {d.multi_vendor && !(c.lines[k].up > 0) ? <span className="note">ไม่ได้เสนอ</span> : fmt(c.lines[k].up)}
                        {c.lines[k].hasDisc && <div className="note">ลด {normDisc(it.discount)} → {fmt(c.lines[k].net)}</div>}
                        {c.lines[k].up > 0 && <div className="note">= {fmt(c.lines[k].line)}</div>}
                        {it.split ? splitCell(k, 0, a) : tick(k, 0, a)}
                      </td>
                      {d.comps.map((x, ci) => (
                        <td key={ci} className={(a.split ? a.split.some((x) => x.v === ci + 1) : a.pick === ci + 1) ? 'won' : undefined}>
                          <input className="in r" inputMode="decimal" id={`cp${ci}-${k}`} aria-label={`ราคาต่อหน่วย ${x.vendor || `คู่เทียบ ${ci + 1}`} รายการที่ ${k + 1}`} value={x.prices[k] ?? ''} placeholder={d.multi_vendor ? 'ไม่ได้เสนอ' : '0.00'}
                            onChange={(e) => setPrice(ci, k, e.target.value)}
                            onBlur={() => { const v = num(x.prices[k]); if (v > 0) setPrice(ci, k, fmt(v)); }}
                            onPaste={(e) => pasteDown(e, (m, v) => setPrice(ci, m, v), k)} />
                          <input className="in r disc" id={`cd${ci}-${k}`} aria-label={`ส่วนลด ${x.vendor || `คู่เทียบ ${ci + 1}`} รายการที่ ${k + 1}`} value={x.discounts[k] ?? ''} placeholder="ส่วนลด 5% / 100"
                            aria-invalid={!!c.comps[ci]?.lines[k]?.discErr} style={c.comps[ci]?.lines[k]?.discErr ? { borderColor: 'var(--bad)' } : undefined}
                            onChange={(e) => setPrice(ci, k, e.target.value, 'discounts')}
                            onPaste={(e) => pasteDown(e, (m, v) => setPrice(ci, m, v, 'discounts'), k)} />
                          <div className="note num" style={{ textAlign: 'right', color: c.comps[ci]?.lines[k]?.discErr ? 'var(--bad)' : undefined }}>
                            {c.comps[ci]?.lines[k]?.discErr || (c.comps[ci]?.lines[k]?.up > 0 && <>{c.comps[ci]?.lines[k]?.hasDisc && <>สุทธิ {fmt(c.comps[ci]?.lines[k]?.net)} · </>}= {fmt(c.comps[ci]?.lines[k]?.line)}</>)}
                          </div>
                          {it.split ? splitCell(k, ci + 1, a) : tick(k, ci + 1, a)}
                        </td>
                      ))}
                    </tr>
                    {a.split && (
                      <tr className="why split">
                        <td />
                        <td colSpan={3 + d.comps.length}>
                          <div className="split-sum" role="status">
                            แบ่งซื้อรายการที่ {k + 1}: {a.split.map((x) => `${vendorName(x.v)} ${x.qty.toLocaleString('en-US')} ${it.unit} (${x.pct}%)`).join(' + ') || 'กรอกจำนวนในช่องของแต่ละเจ้า'}
                            {' · '}รวม <b>{a.sum.toLocaleString('en-US')}</b> / {c.lines[k].q.toLocaleString('en-US')} {it.unit}
                            {a.splitErr ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}> · {a.splitErr}</span> : <span style={{ color: 'var(--sage-ink)', fontWeight: 600 }}> · ครบ 100% ✓ = {fmt(a.line)} บาท</span>}
                          </div>
                          <label className="f" htmlFor={`ar${k}`} style={{ color: 'var(--bad)' }}>
                            เหตุผลที่สั่งซื้อแบบแบ่งปริมาณ · Reason for splitting <span className="req">*</span>
                            <input className="in" id={`ar${k}`} value={it.award_reason} maxLength={500} placeholder="เช่น ราคาใกล้เคียงกัน กระจายความเสี่ยงการส่งของ / เจ้าเดียวส่งไม่พอ"
                              onChange={(e) => setItem(k, { award_reason: e.target.value })} />
                          </label>
                        </td>
                      </tr>
                    )}
                    {a.override && !a.split && (
                      <tr className="why">
                        <td />
                        <td colSpan={3 + d.comps.length}>
                          <label className="f" htmlFor={`ar${k}`} style={{ color: 'var(--bad)' }}>
                            รายการที่ {k + 1}: ซื้อจาก {vendorName(a.pick)} ซึ่งไม่ใช่ราคาต่ำสุด ({vendorName(a.best)} ถูกกว่า {fmt(a.line - (a.best === 0 ? c.lines[k].line : c.comps[a.best - 1].lines[k].line))} บาท) ระบุเหตุผล · Reason <span className="req">*</span>
                            <input className="in" id={`ar${k}`} value={it.award_reason} maxLength={500} placeholder="เช่น ราคาใกล้เคียงแต่ส่งของเร็วกว่า / รับประกันนานกว่า"
                              onChange={(e) => setItem(k, { award_reason: e.target.value })} />
                          </label>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>มูลค่ารวม ก่อน VAT · Subtotal</td>
                    <td className="num sel" style={{ textAlign: 'right' }}>{fmt(c.q1Sub)}{d.multi_vendor && <div className="note">เสนอ {c.q1Quoted}/{n} รายการ</div>}</td>
                    {c.comps.map((x, ci) => <td key={ci} className="num" style={{ textAlign: 'right' }}>{fmt(x.sub)}{d.multi_vendor && <div className="note">เสนอ {x.quoted}/{n} รายการ</div>}</td>)}
                  </tr>
                  <tr>
                    <td colSpan={3}><b>รวม VAT · Total</b></td>
                    <td className="num sel" style={{ textAlign: 'right' }}><b>{fmt(c.q1Total)}</b></td>
                    {c.comps.map((x, ci) => <td key={ci} className="num" style={{ textAlign: 'right' }}><b>{fmt(x.total)}</b></td>)}
                  </tr>
                  <tr>
                    <td colSpan={3}><b>สั่งซื้อตาม ✓ (ก่อน VAT)</b> · Ticked lines</td>
                    {c.byVendor.map((v, i) => (
                      <td key={i} className={`num${i === 0 ? ' sel' : ''}`} style={{ textAlign: 'right', fontWeight: 600, color: v > 0 ? 'var(--sage-ink)' : 'var(--muted)' }}>
                        {v > 0 ? <>✓ {fmt(v)}<div className="note">{c.countFor(i)} รายการ</div></> : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td colSpan={3}>ส่วนต่างจากเจ้าที่ 1 · Difference</td>
                    <td className="sel" style={{ textAlign: 'right' }}>—</td>
                    {c.comps.map((x, ci) => (
                      <td key={ci} className="num" style={{ textAlign: 'right', fontWeight: 600, color: !x.complete || x.diff == null ? 'var(--muted)' : x.diff >= 0 ? 'var(--sage-ink)' : 'var(--bad)' }}>
                        {x.diff == null ? 'ไม่เทียบ (เสนอไม่ครบ)' : !x.complete ? 'กรอกให้ครบ' : x.diff >= 0 ? `สูงกว่า +${fmt(x.diff)}` : `ต่ำกว่า −${fmt(-x.diff)}`}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td colSpan={3}>การรับประกัน · Warranty</td>
                    <td className="sel" style={{ textAlign: 'right' }}>{d.warranty.trim() || '—'}</td>
                    {d.comps.map((x, ci) => (
                      <td key={ci}><input className="in" id={`cw${ci}`} aria-label={`การรับประกัน ${x.vendor || `คู่เทียบ ${ci + 1}`}`} value={x.warranty} maxLength={200} placeholder="เช่น 1 ปี"
                        onChange={(e) => setComp(ci, { warranty: e.target.value })} /></td>
                    ))}
                  </tr>
                  <tr>
                    <td colSpan={3}>เครดิต (วัน) · Credit</td>
                    <td className="num sel" style={{ textAlign: 'right' }}>{d.credit_days.trim() ? `${d.credit_days.trim()} วัน` : '—'}</td>
                    {d.comps.map((x, ci) => (
                      <td key={ci}><input className="in r" inputMode="numeric" id={`cc${ci}`} aria-label={`เครดิต (วัน) ${x.vendor || `คู่เทียบ ${ci + 1}`}`} value={x.credit_days} placeholder="วัน"
                        aria-invalid={!!parseDays(x.credit_days).error} onChange={(e) => setComp(ci, { credit_days: e.target.value })} /></td>
                    ))}
                  </tr>
                  <tr>
                    <td colSpan={3}>Lead time (วัน)</td>
                    <td className="num sel" style={{ textAlign: 'right' }}>{d.lead_days.trim() ? `${d.lead_days.trim()} วัน` : '—'}</td>
                    {d.comps.map((x, ci) => (
                      <td key={ci}><input className="in r" inputMode="numeric" id={`cl${ci}`} aria-label={`Lead time (วัน) ${x.vendor || `คู่เทียบ ${ci + 1}`}`} value={x.lead_days} placeholder="วัน"
                        aria-invalid={!!parseDays(x.lead_days).error} onChange={(e) => setComp(ci, { lead_days: e.target.value })} /></td>
                    ))}
                  </tr>
                  <tr>
                    <td colSpan={3}>สถานที่จัดส่งสินค้า · Delivery</td>
                    <td className="sel">{deliveryCell(0)}</td>
                    {d.comps.map((_, ci) => <td key={ci}>{deliveryCell(ci + 1)}</td>)}
                  </tr>
                </tfoot>
              </table>
            </div>
            {c.awards.some((a) => a.override) ? null : c.comps.length > 0 && c.comps.every((x) => x.complete) && (
              <div className="ok-box" style={{ color: 'var(--sage-ink)' }}>✓ ทุกรายการสั่งซื้อจากผู้ขายที่ราคาต่ำสุด · Every item from the lowest price</div>
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
        <Modal title="ตัวอย่างร่างตารางเปรียบเทียบราคา · Draft preview" onClose={() => setModal(null)} wide>
          <div className="letter-wrap"><ApprovalDoc r={previewRow} steps={previewSteps} draft /></div>
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
            {approvers.map((a) => <li key={a.step_no}>{a.approver_name || '—'} — {a.pos_th}{a.sign_mode === 'wet' ? ' (ลายเซ็นสด บนกระดาษ)' : ''}</li>)}
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
          <div className="row" style={{ gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <div className="box" style={{ flex: '1 1 220px', display: 'grid', gap: 6, alignContent: 'start' }}>
              <b>1 · ดาวน์โหลดฟอร์มไปกรอก</b>
              <span className="note">1 แถว = 1 รายการ · มีชีต “วิธีกรอก” และตัวอย่างในไฟล์</span>
              <button type="button" className="btn sm" style={{ justifySelf: 'start' }} onClick={() => downloadItemForm()}>⬇ ดาวน์โหลดฟอร์ม Excel · Form</button>
            </div>
            <label className={`box file-drop${dragging ? ' on' : ''}`} htmlFor="items-file" style={{ flex: '2 1 260px', cursor: 'pointer', display: 'grid', gap: 6, alignContent: 'center', textAlign: 'center' }} {...dropProps}>
              <b>2 · ลากไฟล์ที่กรอกแล้วมาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</b>
              <span className="note">{pasteFile ? `ไฟล์: ${pasteFile}` : 'ไฟล์ .xlsx · Drop or choose the filled-in form'}</span>
              <input type="file" id="items-file" accept=".xlsx" className="sr" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) takeItemFile(f); }} />
            </label>
          </div>
          <p style={{ margin: 0 }}>หรือคัดลอกแถวจาก Excel แล้ววางด้านล่าง 1 แถว = 1 รายการ เรียงคอลัมน์ดังนี้ · Or copy rows from Excel, one row per item, columns in this order:</p>
          <div className="box mono" style={{ fontSize: 13 }}>SKU ⇥ จำนวน ⇥ ราคาต่อหน่วยก่อน VAT ⇥ ส่วนลด (5% / 100 / ว่าง) ⇥ ราคาก่อนหน้า ⇥ คำต่อท้าย</div>
          <textarea className="in mono" id="paste-text" aria-label="ข้อมูลที่วาง · Pasted rows" style={{ minHeight: 160 }} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'AC-INV-18000\t6\t29050\t5%\t28500\tติดตั้งห้องประชุม'} />
          <span className="note">พบ {parsePasted(pasteText).length} รายการ · rows found{n + parsePasted(pasteText).length > MAX_ITEMS ? ` (เกิน ${MAX_ITEMS} รายการ จะเพิ่มเท่าที่ได้)` : ''}</span>
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setModal(null)}>ยกเลิก · Cancel</button>
            <button
              className="btn p"
              disabled={!parsePasted(pasteText).length}
              onClick={() => {
                const rows = parsePasted(pasteText);
                const onlyBlank = d.items.length === 1 && !d.items[0].sku.trim() && !d.items[0].unit_price.trim();
                if (onlyBlank) setD((x) => (x ? { ...x, items: rows.slice(0, MAX_ITEMS), comps: x.comps.map((cp) => ({ ...cp, prices: rows.slice(0, MAX_ITEMS).map(() => ''), discounts: rows.slice(0, MAX_ITEMS).map(() => '') })) } : x));
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
