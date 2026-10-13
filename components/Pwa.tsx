'use client';
import { useEffect, useState } from 'react';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
declare global {
  interface Window { __qaInstall?: InstallEvent | null }
}

/** Registers the service worker and keeps Chrome's install prompt for the install button. */
export function PwaSetup() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__qaInstall = e as InstallEvent;
      window.dispatchEvent(new Event('qa-install-ready'));
    };
    const onInstalled = () => {
      window.__qaInstall = null;
      window.dispatchEvent(new Event('qa-install-ready'));
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  return null;
}

type Platform = 'installed' | 'ios' | 'android' | 'desktop';

function detect(): Platform {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  if (standalone) return 'installed';
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-3px' }}>
      <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

/** Install button (Android/desktop Chrome & Edge) or step-by-step help (iPhone/iPad). */
export function InstallApp({ compact, onDone }: { compact?: boolean; onDone?: () => void }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);

  useEffect(() => {
    setPlatform(detect());
    const sync = () => setCanPrompt(!!window.__qaInstall);
    sync();
    window.addEventListener('qa-install-ready', sync);
    return () => window.removeEventListener('qa-install-ready', sync);
  }, []);

  if (!platform) return null;
  if (platform === 'installed')
    return compact ? null : <div className="ok-box">✓ ติดตั้งแอปบนเครื่องนี้แล้ว · Installed on this device</div>;

  async function install() {
    const ev = window.__qaInstall;
    if (!ev) return;
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    window.__qaInstall = null;
    setCanPrompt(false);
    if (outcome === 'accepted') onDone?.();
  }

  if (canPrompt)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="btn p" onClick={install}>📲 ติดตั้งแอปบนหน้าจอหลัก · Install app</button>
        {!compact && <span className="note">แอปจะมีไอคอนบนหน้าจอหลัก เปิดแบบเต็มจอเหมือนแอปทั่วไป · Adds an icon to your home screen</span>}
      </div>
    );

  if (platform === 'ios')
    return (
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <li>เปิดลิงก์นี้ใน <b>Safari</b> (ถ้าเปิดจาก LINE หรือ Teams ให้กด ⋯ แล้วเลือก “เปิดใน Safari”)</li>
        <li>กดปุ่ม <b>แชร์</b> <ShareIcon /> ที่แถบด้านล่าง (iPad: มุมขวาบน)</li>
        <li>เลื่อนลงแล้วกด <b>เพิ่มไปยังหน้าจอโฮม · Add to Home Screen</b></li>
        <li>กด <b>เพิ่ม · Add</b> มุมขวาบน ไอคอน “อนุมัติราคา” จะอยู่บนหน้าจอหลัก</li>
      </ol>
    );

  if (platform === 'android')
    return (
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <li>เปิดลิงก์นี้ใน <b>Chrome</b> (ถ้าเปิดจาก LINE หรือ Teams ให้กด ⋮ แล้วเลือก “เปิดในเบราว์เซอร์”)</li>
        <li>กดเมนู <b>⋮</b> มุมขวาบน</li>
        <li>เลือก <b>ติดตั้งแอป · Install app</b> หรือ <b>เพิ่มไปที่หน้าจอหลัก · Add to Home screen</b></li>
        <li>กด <b>ติดตั้ง · Install</b> ไอคอนจะอยู่บนหน้าจอหลักและในรายการแอป</li>
      </ol>
    );

  return (
    <span className="note" style={{ fontSize: 14 }}>
      บนคอมพิวเตอร์ (Chrome / Edge) กดไอคอน <b>ติดตั้ง</b> ⊕ ท้ายแถบที่อยู่เว็บ หรือเมนู ⋯ → <b>Apps → Install this site as an app</b> ·
      บนมือถือ เปิดลิงก์นี้แล้วกลับมาที่หน้านี้เพื่อดูวิธีติดตั้ง
    </span>
  );
}

/** One-time banner on phones that are not yet using the installed app. */
export function InstallBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const p = detect();
    let dismissed = false;
    try { dismissed = localStorage.getItem('qa-install-dismissed') === '1'; } catch { /* storage blocked */ }
    setShow((p === 'ios' || p === 'android') && !dismissed);
  }, []);
  if (!show) return null;
  const close = () => {
    try { localStorage.setItem('qa-install-dismissed', '1'); } catch { /* ignore */ }
    setShow(false);
  };
  return (
    <div className="card" style={{ borderColor: 'var(--tan)', background: 'var(--softer)', gap: 10 }}>
      <div className="actions">
        <b>ติดตั้งแอปไว้บนหน้าจอหลัก · Add to home screen</b>
        <button className="btn sm" onClick={close}>ไม่ใช่ตอนนี้ · Later</button>
      </div>
      <InstallApp compact onDone={close} />
    </div>
  );
}
