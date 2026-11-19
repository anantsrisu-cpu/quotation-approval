'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApp } from './AppProvider';
import { downloadSheetWithAttachments } from '@/lib/mergePdf';
import type { RequestRow } from '@/lib/types';

/** Approved requests: download the signed comparison sheet + PDF attachments (one file) straight from a list. */
export function PdfButton({ r }: { r: Pick<RequestRow, 'id' | 'no' | 'status' | 'letter_path'> }) {
  const { sb, toast } = useApp();
  const [busy, setBusy] = useState(false);
  if (r.status !== 'approved') return null;
  // the PDF is made when the request page is first opened after the last approval
  if (!r.letter_path)
    return <Link className="btn sm" href={`/requests/${r.id}`} title="เปิดคำขอเพื่อสร้างไฟล์ PDF · Open to create the PDF">PDF</Link>;
  const file = `${r.no || 'letter'}.pdf`;
  async function go() {
    setBusy(true);
    try {
      const res = await downloadSheetWithAttachments(sb, { id: r.id, letter_path: r.letter_path! }, file);
      if (res.skipped.length) toast('bad', 'บางไฟล์แนบรวมไม่ได้ · Some attachments were left out', `${res.skipped.join(', ')} — เปิดคำขอแล้วปริ้นไฟล์นั้นแยก`);
    } catch (e: any) {
      toast('bad', 'ดาวน์โหลดไม่สำเร็จ · Download failed', e?.message || '');
    }
    setBusy(false);
  }
  return (
    <button className="btn p sm pdf-btn" onClick={go} disabled={busy} title="ดาวน์โหลด PDF ตารางเปรียบเทียบราคา + ไฟล์แนบ เพื่อปริ้น · Download PDF to print">
      {busy ? '…' : '🖨 PDF'}
    </button>
  );
}
