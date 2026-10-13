'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { reportError } from '@/lib/errors';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error.message || 'Page crashed', { action: 'error-boundary', detail: (error.stack || '') + (error.digest ? '\ndigest ' + error.digest : '') });
  }, [error]);
  return (
    <div className="bad-box" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <b>หน้านี้แสดงผลไม่สำเร็จ · This screen failed to load</b>
      <span>ระบบแจ้งผู้ดูแลแล้ว ลองอีกครั้ง หรือกลับหน้าหลัก · The admin has been notified. Try again or go home.</span>
      <span className="note">{error.message}</span>
      <div className="row" style={{ gap: 10 }}>
        <button className="btn p" onClick={reset}>ลองอีกครั้ง · Try again</button>
        <Link className="btn" href="/">หน้าหลัก · Home</Link>
      </div>
    </div>
  );
}
