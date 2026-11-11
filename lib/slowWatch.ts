'use client';
import { reportError } from './errors';

/**
 * Watches for the page freezing (an input or click that waited 1 s or more before the
 * page could respond) and sends what was keeping the browser busy to the admin bug list:
 * this app's code, a browser extension, the Vercel toolbar, or the browser itself.
 * Uses the browser's Event Timing and Long Animation Frame reports (Chrome / Edge);
 * does nothing in browsers without them.
 */

const SLOW_MS = 1000;
const MAX_REPORTS = 3;

interface Script { sourceURL?: string; invoker?: string; invokerType?: string; duration: number; startTime: number; forcedStyleAndLayoutDuration?: number; sourceFunctionName?: string }
interface Frame { startTime: number; duration: number; blockingDuration?: number; scripts?: Script[] }

function who(url: string) {
  if (!url) return 'เบราว์เซอร์ (ไม่มีสคริปต์) · browser';
  if (/^(chrome|moz|ms-browser|safari-web)?-?extension:\/\//.test(url)) return 'ส่วนเสริมของเบราว์เซอร์ · extension';
  if (/vercel\.(live|com)|_vercel/.test(url)) return 'Vercel toolbar';
  if (url.startsWith(location.origin)) return 'แอปนี้ · this app';
  return 'สคริปต์ภายนอก · other site';
}

export function startSlowWatch(report: typeof reportError = reportError) {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  const types = PerformanceObserver.supportedEntryTypes || [];
  if (!types.includes('event')) return () => {};
  const frames: Frame[] = [];
  let sent = 0;
  const seen = new Set<number>();

  const lo = types.includes('long-animation-frame')
    ? new PerformanceObserver((l) => {
        frames.push(...(l.getEntries() as unknown as Frame[]));
        if (frames.length > 40) frames.splice(0, frames.length - 40);
      })
    : null;
  lo?.observe({ type: 'long-animation-frame', buffered: true });

  const ev = new PerformanceObserver((l) => {
    for (const e of l.getEntries() as PerformanceEventTiming[]) {
      if (sent >= MAX_REPORTS || e.duration < SLOW_MS) continue;
      // one report per interaction (keydown + keypress + input share an id)
      const id = (e as PerformanceEventTiming & { interactionId?: number }).interactionId || Math.round(e.startTime);
      if (seen.has(id)) continue;
      seen.add(id);
      sent++;
      const delay = Math.round(e.processingStart - e.startTime);
      const run = Math.round(e.processingEnd - e.processingStart);
      const t = e.target as HTMLElement | null;
      const target = t ? `${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}${typeof t.className === 'string' && t.className ? '.' + t.className.trim().split(/\s+/).join('.') : ''}` : '—';
      // frames that overlap the wait
      const end = e.startTime + e.duration;
      const busy = frames.filter((f) => f.startTime < end && f.startTime + f.duration > e.startTime - 50);
      const scripts = busy.flatMap((f) => f.scripts || []).sort((a, b) => b.duration - a.duration).slice(0, 8);
      const byWho: Record<string, number> = {};
      scripts.forEach((s) => { const k = who(s.sourceURL || ''); byWho[k] = (byWho[k] || 0) + s.duration; });
      const busyMs = Math.round(busy.reduce((a, f) => a + f.duration, 0));
      const scriptMs = Math.round(scripts.reduce((a, s) => a + s.duration, 0));
      const main = Object.entries(byWho).sort((a, b) => b[1] - a[1])[0]?.[0]
        || (lo ? 'เบราว์เซอร์/ระบบ (ไม่มีสคริปต์ของหน้าเว็บทำงานอยู่) · browser or OS' : 'ไม่ทราบ (เบราว์เซอร์ไม่รองรับการวัด) · unknown');
      const lines = [
        `event: ${e.name} on ${target}`,
        `รอก่อนเริ่มทำงาน (input delay): ${delay} ms · โค้ดของแอปตอบสนอง (processing): ${run} ms · รวม: ${Math.round(e.duration)} ms`,
        `ช่วงที่ค้าง: frame ยาว ${busy.length} ช่วง รวม ${busyMs} ms · เป็นสคริปต์ ${scriptMs} ms`,
        `สาเหตุหลัก: ${main}`,
        ...Object.entries(byWho).map(([k, v]) => `  ${k}: ${Math.round(v)} ms`),
        ...scripts.map((s) => `  - ${Math.round(s.duration)} ms · ${s.invokerType || ''} ${s.invoker || ''} · ${(s.sourceURL || '(none)').replace(/\?.*$/, '')}${s.sourceFunctionName ? ' ' + s.sourceFunctionName : ''}${s.forcedStyleAndLayoutDuration ? ` · layout ${Math.round(s.forcedStyleAndLayoutDuration)} ms` : ''}`),
        `hidden: ${document.visibilityState} · cores: ${navigator.hardwareConcurrency || '?'} · memory: ${(navigator as Navigator & { deviceMemory?: number }).deviceMemory || '?'} GB`,
      ];
      report(`หน้าเว็บค้าง ${(e.duration / 1000).toFixed(1)} วินาที ขณะ ${e.name} · Page froze`, { action: 'slow-interaction', detail: lines.join('\n') });
    }
  });
  try {
    ev.observe({ type: 'event', durationThreshold: SLOW_MS, buffered: true } as PerformanceObserverInit);
  } catch {
    return () => lo?.disconnect();
  }
  return () => { ev.disconnect(); lo?.disconnect(); };
}
