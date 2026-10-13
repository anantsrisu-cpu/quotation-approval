import type { RequestStatus } from './types';

export const SUBJ: Record<string, string> = { stock: 'สั่งซื้อเพื่อสต๊อค', general: 'สั่งซื้อทั่วไป', hire: 'สั่งจ้าง' };
export const SUBJ_EN: Record<string, string> = { stock: 'Purchase for stock', general: 'General purchase', hire: 'Hire / service' };
export const PURP: Record<string, string> = { repair: 'ซ่อมแซม', replace: 'ทดแทนของเดิม', stock: 'Stock' };
export const UNITS = ['เครื่อง', 'ชิ้น', 'ชุด', 'กล่อง', 'รีม', 'ตัว', 'งาน', 'อัน', 'แพ็ค', 'ม้วน', 'เมตร', 'ลิตร'];
export const ROLE_TH: Record<string, string> = { preparer: 'ผู้จัดทำ', approver: 'ผู้อนุมัติ', admin: 'ผู้ดูแลระบบ' };
export const ROLE_EN: Record<string, string> = { preparer: 'Preparer', approver: 'Approver', admin: 'Admin' };

export const ST: Record<RequestStatus, [string, string, string]> = {
  draft: ['ฉบับร่าง', 'Draft', 'st-draft'],
  pending: ['รออนุมัติ', 'Pending', 'st-pend'],
  approved: ['อนุมัติแล้ว', 'Approved', 'st-ok'],
  rejected: ['ไม่อนุมัติ', 'Rejected', 'st-bad'],
  cancelled: ['ยกเลิก', 'Cancelled', 'st-draft'],
};

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

export const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const fmt = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtQty = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });

export const dt = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('en-GB') + ' ' + d.toTimeString().slice(0, 5);
};
export const dOnly = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-GB') : '');
export const thDate = (s?: string | null) => {
  const d = s ? new Date(s) : new Date();
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543);
};
export const enDate = (s?: string | null) => {
  const d = s ? new Date(s) : new Date();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

/** Thai number words, e.g. 186501 → หนึ่งแสนแปดหมื่นหกพันห้าร้อยเอ็ด */
export function numTh(n: number): string {
  const D = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const P = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  if (n === 0) return 'ศูนย์';
  let s = '';
  if (n >= 1e6) {
    s += numTh(Math.floor(n / 1e6)) + 'ล้าน';
    n = n % 1e6;
    if (n === 0) return s;
  }
  const str = String(n);
  const L = str.length;
  for (let i = 0; i < L; i++) {
    const d = +str[i];
    const p = L - i - 1;
    if (!d) continue;
    if (p === 0 && d === 1 && (L > 1 || s)) s += 'เอ็ด';
    else if (p === 1 && d === 2) s += 'ยี่';
    else if (p === 1 && d === 1) s += '';
    else s += D[d];
    s += P[p];
  }
  return s;
}
export function bahtText(v: number): string {
  const n = r2(v);
  const b = Math.floor(n);
  const st = Math.round((n - b) * 100);
  return numTh(b) + 'บาท' + (st ? numTh(st) + 'สตางค์' : 'ถ้วน');
}

/** Short verification code printed on the letter footer. */
export function verifyCode(s: string) {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function fileSize(bytes: number) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

/** Supabase/Postgres error → readable Thai/English message. */
export function errText(e: unknown): string {
  if (!e) return '';
  const anyE = e as { message?: string; error_description?: string; details?: string };
  const m = anyE.message || anyE.error_description || String(e);
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง · Cannot reach the server';
  if (/JWT|session/i.test(m) && /expired|invalid/i.test(m)) return 'หมดเวลาการเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่ · Session expired, please sign in again';
  if (/row-level security|permission denied/i.test(m)) return 'คุณไม่มีสิทธิ์ทำรายการนี้ · You do not have permission for this';
  return m;
}
