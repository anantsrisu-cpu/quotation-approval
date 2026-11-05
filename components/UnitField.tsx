'use client';
import { useState } from 'react';
import { useApp } from './AppProvider';

const OTHER = '__other__';

/**
 * หน่วย dropdown from the units list (ตั้งค่าระบบ → หน่วยสินค้า).
 * "+ พิมพ์หน่วยอื่น" turns it into a text box for a unit that is not in the list yet.
 */
export function UnitField({ id, value, onChange, label = 'หน่วย' }: { id: string; value: string; onChange: (v: string) => void; label?: string }) {
  const { units } = useApp();
  const [typing, setTyping] = useState(false);
  const opts = Array.from(new Set([...units, value].filter(Boolean)));
  if (typing)
    return (
      <span className="unit-type">
        <input className="in" id={id} aria-label={label} value={value} maxLength={20} autoFocus placeholder="เช่น ถัง"
          onChange={(e) => onChange(e.target.value)} onBlur={() => onChange(value.trim())} />
        <button type="button" className="unit-back" onClick={() => setTyping(false)} aria-label="กลับไปเลือกจากรายการ · Back to the list" title="เลือกจากรายการ">▾</button>
      </span>
    );
  return (
    <select className="in" id={id} aria-label={label} value={value}
      onChange={(e) => {
        if (e.target.value === OTHER) {
          setTyping(true);
          onChange('');
        } else onChange(e.target.value);
      }}>
      {!value && <option value="">— เลือก —</option>}
      {opts.map((u) => <option key={u} value={u}>{u}</option>)}
      <option value={OTHER}>+ พิมพ์หน่วยอื่น…</option>
    </select>
  );
}
