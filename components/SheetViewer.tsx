'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SHEET_H, SHEET_W } from '@/lib/compareSheet';

const GAP = 16; // space between sheet pages (same as .sheet-host)
const MAX_ZOOM = 3;

/**
 * Shows the landscape comparison sheet scaled down to the width of the screen, so a phone
 * sees whole pages instead of a slice. Tapping it opens a full-screen viewer with zoom.
 * The real (unscaled) sheet stays in the page, so the PDF is made exactly as before.
 */
export function FitSheet({ children, title }: { children: React.ReactNode; title: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ s: 1, h: 0 });
  const [html, setHtml] = useState<string | null>(null);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const s = Math.min(1, o.clientWidth / SHEET_W);
        const h = Math.ceil(i.offsetHeight * s);
        setFit((f) => (Math.abs(f.s - s) < 0.001 && f.h === h ? f : { s, h }));
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const small = fit.s < 0.98;
  const open = () => {
    const host = inner.current?.querySelector('.sheet-host');
    if (host?.innerHTML) setHtml(host.innerHTML);
  };

  return (
    <>
      {small && (
        <button type="button" className="btn sm sheet-open" onClick={open}>
          🔍 ดูเต็มจอ / ซูม · View full screen
        </button>
      )}
      <div
        ref={outer}
        className={`sheet-fit${small ? ' small' : ''}`}
        style={small ? { height: fit.h } : undefined}
        onClick={small ? open : undefined}
        role={small ? 'button' : undefined}
        tabIndex={small ? 0 : undefined}
        aria-label={small ? `${title} — แตะเพื่อดูเต็มจอ · Tap to view full screen` : undefined}
        onKeyDown={small ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open()) : undefined}
      >
        <div ref={inner} className="sheet-fit-inner" style={small ? { width: SHEET_W, transform: `scale(${fit.s})` } : undefined}>
          {children}
        </div>
      </div>
      {html && <SheetZoom html={html} title={title} onClose={() => setHtml(null)} />}
    </>
  );
}

/** Full-screen viewer: fit / zoom buttons, pinch to zoom, double-tap, drag to move. */
function SheetZoom({ html, title, onClose }: { html: string; title: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 }); // unscaled size of all pages
  const [fitZ, setFitZ] = useState(0.3);
  const [z, setZ] = useState<number | null>(null);
  const zoom = z ?? fitZ;
  const zr = useRef(zoom);
  zr.current = zoom;
  const fr = useRef(fitZ);
  fr.current = fitZ;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pages = Math.max(1, (html.match(/class="cs-page/g) || []).length);
  const [portrait, setPortrait] = useState(false);

  // the pages are copied in once: re-setting them on every zoom step would cut off touch gestures
  useLayoutEffect(() => {
    if (body.current) body.current.innerHTML = html;
  }, [html]);

  // fit the page width to the screen (re-fit when the phone is turned)
  useLayoutEffect(() => {
    const el = box.current;
    const b = body.current;
    if (!el || !b) return;
    const measure = () => {
      setSize({ w: b.offsetWidth, h: b.offsetHeight });
      // the box width without depending on scroll bars (they come and go while zooming)
      setFitZ(Math.min(1, (el.getBoundingClientRect().width - 16) / SHEET_W));
      setPortrait(window.innerHeight > window.innerWidth && window.innerWidth < 700);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the phone's back button closes the viewer (an extra history entry while it is open)
  const close = useCallback(() => {
    if (history.state?.sheetZoom) history.back();
    else closeRef.current();
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // the page behind does not scroll
    history.pushState({ ...(history.state || {}), sheetZoom: 1 }, '');
    const back = () => closeRef.current();
    window.addEventListener('popstate', back);
    return () => {
      window.removeEventListener('keydown', k);
      window.removeEventListener('popstate', back);
      document.body.style.overflow = prev;
    };
  }, [close]);

  /** set the zoom, keeping the point (cx, cy) of the screen where it is */
  const zoomAt = useCallback((next: number, cx?: number, cy?: number) => {
    const el = box.current;
    if (!el) return;
    const n = Math.max(fr.current, Math.min(MAX_ZOOM, next));
    const r = el.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left;
    const py = (cy ?? r.top + r.height / 2) - r.top;
    const ux = (el.scrollLeft + px) / zr.current;
    const uy = (el.scrollTop + py) / zr.current;
    setZ(n);
    requestAnimationFrame(() => {
      el.scrollLeft = ux * n - px;
      el.scrollTop = uy * n - py;
    });
  }, []);

  // pinch to zoom + double tap (touch screens)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let pinch: { d: number; z: number } | null = null;
    let lastTap = 0;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
    const start = (e: TouchEvent) => {
      if (e.touches.length === 1) pinch = null;
      if (e.touches.length === 2) {
        pinch = { d: dist(e.touches), z: zr.current };
        e.preventDefault();
      }
    };
    const move = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const [cx, cy] = mid(e.touches);
      zoomAt(pinch.z * (dist(e.touches) / pinch.d), cx, cy);
    };
    const end = (e: TouchEvent) => {
      if (pinch && e.touches.length < 2) { pinch = null; return; }
      if (e.changedTouches.length !== 1 || e.touches.length) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        const t = e.changedTouches[0];
        zoomAt(zr.current > fr.current * 1.2 ? fr.current : Math.max(1, fr.current * 2.2), t.clientX, t.clientY);
        lastTap = 0;
      } else lastTap = now;
    };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [zoomAt]);

  // mouse: drag to move when zoomed in
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || !box.current) return;
    drag.current = { x: e.clientX, y: e.clientY, l: box.current.scrollLeft, t: box.current.scrollTop };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !box.current) return;
    box.current.scrollLeft = d.l - (e.clientX - d.x);
    box.current.scrollTop = d.t - (e.clientY - d.y);
  };

  const pct = Math.round(zoom * 100);
  return (
    <div className="sz" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sz-bar">
        <b className="sz-title">{title} <span className="sz-pages">{pages} หน้า</span></b>
        <div className="sz-tools">
          <button type="button" className="btn sm" onClick={() => zoomAt(zoom / 1.4)} disabled={zoom <= fitZ + 0.001} aria-label="ย่อ · Zoom out">−</button>
          <span className="sz-pct" aria-live="polite">{pct}%</span>
          <button type="button" className="btn sm" onClick={() => zoomAt(zoom * 1.4)} disabled={zoom >= MAX_ZOOM - 0.001} aria-label="ขยาย · Zoom in">+</button>
          <button type="button" className="btn sm" onClick={() => { setZ(null); box.current?.scrollTo(0, 0); }}>พอดีจอ · Fit</button>
          <button type="button" className="btn sm p" id="sz-close" onClick={close}>ปิด · Close</button>
        </div>
      </div>
      {portrait && <div className="sz-hint">หมุนโทรศัพท์เป็นแนวนอนจะเห็นตัวอักษรใหญ่ขึ้น · ใช้ 2 นิ้วถ่างเพื่อซูม หรือแตะ 2 ครั้ง · Turn the phone sideways · pinch or double-tap to zoom</div>}
      <div
        ref={box}
        className={`sz-body${zoom > fitZ + 0.001 ? ' zoomed' : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
      >
        <div className="sz-space" style={{ width: Math.max(size.w * zoom, 1), height: Math.max(size.h * zoom, 1) }}>
          <div
            ref={body}
            className="sheet-host sz-pages-wrap"
            style={{ width: SHEET_W, transform: `scale(${zoom})`, minHeight: SHEET_H, gap: GAP }}
          />
        </div>
      </div>
    </div>
  );
}
