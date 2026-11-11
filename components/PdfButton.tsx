'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApp } from './AppProvider';
import { downloadUrl } from '@/lib/pdf';
import type { RequestRow } from '@/lib/types';

/** Approved requests: download the signed comparison-sheet PDF straight from a list. */
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
    const { data, error } = await sb.storage.from('letters').createSignedUrl(r.letter_path!, 120, { download: file });
    setBusy(false);
    if (error || !data) return toast('bad', 'ดาวน์โหลดไม่สำเร็จ · Download failed', error?.message);
    downloadUrl(data.signedUrl, file);
  }
  return (
    <button className="btn p sm pdf-btn" onClick={go} disabled={busy} title="ดาวน์โหลด PDF ตารางเปรียบเทียบราคาเพื่อปริ้น · Download PDF to print">
      {busy ? '…' : '🖨 PDF'}
    </button>
  );
}
