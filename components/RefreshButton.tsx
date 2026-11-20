'use client';
import { useState } from 'react';
import { Modal } from './ui';
import { isDirty } from '@/lib/dirty';

/** โหลดหน้าใหม่ (F5) — for phones and the installed app, which have no reload key. */
export function RefreshButton() {
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const reload = () => {
    setBusy(true);
    window.location.reload();
  };
  return (
    <>
      <button type="button" className={`out refresh${busy ? ' spin' : ''}`} id="refresh" disabled={busy}
        onClick={() => (isDirty() ? setAsk(true) : reload())} title="โหลดหน้าใหม่ (เหมือนกด F5) · Reload the page">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" />
        </svg>
        {busy ? 'กำลังโหลด… · Loading' : 'รีเฟรช · Refresh'}
      </button>
      {ask && (
        <Modal title="มีข้อมูลที่ยังไม่ได้บันทึก · Unsaved changes" onClose={() => setAsk(false)}>
          <p style={{ margin: 0 }}>ข้อมูลที่กรอกในหน้านี้ยังไม่ได้บันทึก ถ้ารีเฟรชตอนนี้ข้อมูลส่วนนั้นจะหายไป · กด <b>ยกเลิก</b> แล้วกด “บันทึกร่าง” ก่อน จะปลอดภัยกว่า</p>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" id="refresh-cancel" onClick={() => setAsk(false)}>ยกเลิก · Cancel</button>
            <button type="button" className="btn d" id="refresh-anyway" onClick={reload}>รีเฟรชเลย (ข้อมูลที่ยังไม่บันทึกจะหาย)</button>
          </div>
        </Modal>
      )}
    </>
  );
}
