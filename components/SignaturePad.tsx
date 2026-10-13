'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface PadHandle {
  /** PNG data URL (600×200) or null when nothing was drawn */
  getData: () => string | null;
  clear: () => void;
}

export const SignaturePad = forwardRef<PadHandle, { label?: string }>(function SignaturePad({ label }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dirty = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const w = c.clientWidth || 400;
    const h = c.clientHeight || 160;
    c.width = w * ratio;
    c.height = h * ratio;
    const x = c.getContext('2d')!;
    x.scale(ratio, ratio);
    x.lineWidth = 2.4;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.strokeStyle = '#1B2F6B';
    let on = false;
    let last = { x: 0, y: 0 };
    const pt = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      on = true;
      last = pt(e);
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const move = (e: PointerEvent) => {
      if (!on) return;
      const p = pt(e);
      x.beginPath();
      x.moveTo(last.x, last.y);
      x.lineTo(p.x, p.y);
      x.stroke();
      last = p;
      dirty.current = true;
    };
    const up = () => { on = false; };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    getData() {
      const c = canvas.current;
      if (!c || !dirty.current) return null;
      const o = document.createElement('canvas');
      o.width = 600;
      o.height = 200;
      const ctx = o.getContext('2d')!;
      const s = Math.min(600 / c.width, 200 / c.height);
      const w = c.width * s;
      const h = c.height * s;
      ctx.drawImage(c, (600 - w) / 2, (200 - h) / 2, w, h);
      return o.toDataURL('image/png');
    },
    clear() {
      const c = canvas.current;
      if (!c) return;
      c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
      dirty.current = false;
    },
  }));

  return <canvas ref={canvas} className="pad" aria-label={label || 'วาดลายเซ็นในกรอบนี้ · Draw your signature'} />;
});

/** Fit an uploaded image into a 600×200 PNG signature. */
export function imageToSignature(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('ไฟล์ต้องเป็นรูปภาพ · Image files only'));
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const o = document.createElement('canvas');
        o.width = 600;
        o.height = 200;
        const ctx = o.getContext('2d')!;
        const s = Math.min(600 / img.width, 200 / img.height);
        ctx.drawImage(img, (600 - img.width * s) / 2, (200 - img.height * s) / 2, img.width * s, img.height * s);
        resolve(o.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('อ่านรูปไม่ได้ · Could not read the image'));
      img.src = String(fr.result);
    };
    fr.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้ · Could not read the file'));
    fr.readAsDataURL(file);
  });
}
