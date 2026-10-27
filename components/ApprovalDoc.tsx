'use client';
import { forwardRef, useState } from 'react';
import { CompareSheet, useSheetData } from './CompareSheet';
import type { RequestRow, RequestStep } from '@/lib/types';

/**
 * The approval document: the landscape comparison sheet (ตารางเปรียบเทียบราคา),
 * used for the draft preview (watermarked) and, after final approval, for the PDF.
 */
export const ApprovalDoc = forwardRef<HTMLElement, { r: RequestRow; steps: RequestStep[]; draft?: boolean; rev?: number }>(function ApprovalDoc({ r, steps, draft, rev = 0 }, ref) {
  const sheet = useSheetData(r, steps, !!draft, rev);
  const [ready, setReady] = useState(false);
  return (
    <section className="letter-pages" ref={ref} data-ready={ready ? '1' : '0'} aria-label="ตารางเปรียบเทียบราคา">
      <CompareSheet data={sheet} onReady={() => setReady(true)} />
    </section>
  );
});
