'use client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { downloadUrl } from './pdf';

/** a quotation attachment that can be joined to the sheet */
export const isPdfFile = (f: { name?: string | null; mime?: string | null }) =>
  /\.pdf$/i.test(f.name || '') || (f.mime || '').toLowerCase() === 'application/pdf';

export interface MergeResult {
  blob: Blob;
  /** attachments joined after the sheet */
  added: string[];
  /** attachments left out: not PDF, password-protected or damaged */
  skipped: string[];
}

/**
 * One PDF to print: the signed comparison sheet first, then every PDF attachment of the
 * request in the order they were attached. Built in the browser when downloading, so
 * requests approved before this feature get the attachments too.
 */
export async function sheetWithAttachments(sb: SupabaseClient, r: { id: string; letter_path: string }): Promise<MergeResult> {
  const { PDFDocument } = await import('pdf-lib');
  const sheet = await sb.storage.from('letters').download(r.letter_path);
  if (sheet.error || !sheet.data) throw new Error(sheet.error?.message || 'ไม่พบไฟล์ตารางเปรียบเทียบ · Sheet not found');
  const out = await PDFDocument.load(await sheet.data.arrayBuffer());

  const { data: files } = await sb.from('request_files').select('path,name,mime').eq('request_id', r.id).order('id');
  const added: string[] = [];
  const skipped: string[] = [];
  for (const f of (files || []) as { path: string; name: string; mime: string }[]) {
    if (!isPdfFile(f)) {
      skipped.push(`${f.name} (ไม่ใช่ PDF)`);
      continue;
    }
    try {
      const got = await sb.storage.from('attachments').download(f.path);
      if (got.error || !got.data) throw new Error(got.error?.message || 'download');
      const doc = await PDFDocument.load(await got.data.arrayBuffer());
      const pages = await out.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      added.push(f.name);
    } catch (e) {
      const locked = /encrypt/i.test(String((e as Error)?.message || e));
      skipped.push(`${f.name} (${locked ? 'มีรหัสผ่าน' : 'เปิดไม่ได้'})`);
    }
  }
  out.setTitle(`ตารางเปรียบเทียบราคา + ใบเสนอราคา`);
  const bytes = await out.save();
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), added, skipped };
}

/** Builds the joined PDF and saves it as `file`; returns what was left out (for a message). */
export async function downloadSheetWithAttachments(sb: SupabaseClient, r: { id: string; letter_path: string }, file: string) {
  const res = await sheetWithAttachments(sb, r);
  const url = URL.createObjectURL(res.blob);
  downloadUrl(url, file);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return res;
}
