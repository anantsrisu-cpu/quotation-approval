'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

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

/**
 * Opened inside another app's browser (LINE, Teams, Outlook, Facebook …)?
 * Those browsers cannot install apps — the page has to be opened in Safari / Chrome first.
 */
function inAppBrowser(): string | null {
  const ua = navigator.userAgent;
  if (/\bLine\//i.test(ua)) return 'LINE';
  if (/Teams/i.test(ua)) return 'Teams';
  if (/Outlook|OutlookMobile|MSOutlook/i.test(ua)) return 'Outlook';
  if (/FBAN|FBAV|FB_IAB|Messenger/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/MicroMessenger/i.test(ua)) return 'WeChat';
  if (/Android/i.test(ua) && /; wv\)/.test(ua)) return 'แอปอื่น';
  if (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) return 'แอปอื่น';
  return null;
}

/** true on a phone / tablet that is not yet running the installed app */
export function useCanInstall() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const p = detect();
    setShow(p === 'ios' || p === 'android' || (p === 'desktop' && !!window.__qaInstall));
  }, []);
  return show;
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-3px' }}>
      <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

function CopyLink() {
  const [done, setDone] = useState(false);
  const url = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <code style={{ fontSize: 13, userSelect: 'all', wordBreak: 'break-all' }}>{url}</code>
      <button type="button" className="btn sm" onClick={() => {
        navigator.clipboard?.writeText(url).then(() => setDone(true), () => setDone(false));
      }}>{done ? '✓ คัดลอกแล้ว' : 'คัดลอกลิงก์ · Copy link'}</button>
    </div>
  );
}

/** Steps to add the app to the home screen when the browser has no install button of its own. */
function Guide({ platform }: { platform: Platform }) {
  const app = inAppBrowser();
  if (app && (platform === 'ios' || platform === 'android'))
    return (
      <div className="warn-box" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b>ตอนนี้เปิดอยู่ใน {app} ซึ่งติดตั้งแอปไม่ได้</b>
        <span>
          กด {platform === 'ios' ? '⋯ หรือไอคอนเข็มทิศ' : '⋮'} แล้วเลือก <b>“เปิดใน{platform === 'ios' ? ' Safari' : 'เบราว์เซอร์ / Chrome'}”</b>
          {' '}หรือคัดลอกลิงก์ไปวางใน {platform === 'ios' ? 'Safari' : 'Chrome'} แล้วกดปุ่มติดตั้งอีกครั้ง
        </span>
        <CopyLink />
      </div>
    );
  if (platform === 'ios')
    return (
      <ol className="install-steps">
        <li>เปิดลิงก์นี้ใน <b>Safari</b></li>
        <li>กดปุ่ม <b>แชร์</b> <ShareIcon /> ที่แถบด้านล่าง (iPad: มุมขวาบน)</li>
        <li>เลื่อนลงแล้วกด <b>เพิ่มไปยังหน้าจอโฮม · Add to Home Screen</b></li>
        <li>กด <b>เพิ่ม · Add</b> มุมขวาบน ไอคอน “อนุมัติราคา” จะอยู่บนหน้าจอหลัก</li>
      </ol>
    );
  if (platform === 'android')
    return (
      <ol className="install-steps">
        <li>เปิดลิงก์นี้ใน <b>Chrome</b></li>
        <li>กดเมนู <b>⋮</b> มุมขวาบน</li>
        <li>เลือก <b>ติดตั้งแอป · Install app</b> หรือ <b>เพิ่มไปที่หน้าจอหลัก · Add to Home screen</b></li>
        <li>กด <b>ติดตั้ง · Install</b> ไอคอนจะอยู่บนหน้าจอหลักและในรายการแอป</li>
      </ol>
    );
  return (
    <span className="note" style={{ fontSize: 14 }}>
      บนคอมพิวเตอร์ (Chrome / Edge) กดไอคอน <b>ติดตั้ง</b> ⊕ ท้ายแถบที่อยู่เว็บ หรือเมนู ⋯ → <b>Apps → Install this site as an app</b>
    </span>
  );
}

/**
 * The install button is always there on phones. Where the browser lets the page install
 * (Chrome on Android) it installs straight away; elsewhere (iPhone, LINE/Teams browsers …)
 * the same button opens the steps for that phone.
 */
export function InstallApp({ compact, onDone }: { compact?: boolean; onDone?: () => void }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);

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
    if (!ev) {
      setOpen((x) => !x);
      return;
    }
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    window.__qaInstall = null;
    setCanPrompt(false);
    if (outcome === 'accepted') {
      setAccepted(true);
      onDone?.();
    }
  }
  if (accepted) return <div className="ok-box">✓ กำลังติดตั้ง ไอคอน “อนุมัติราคา” จะอยู่บนหน้าจอหลัก · Installing</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button className="btn p" id="install-app" onClick={install} aria-expanded={canPrompt ? undefined : open}>
        📲 ติดตั้งแอปบนหน้าจอหลัก · Install app
      </button>
      {!canPrompt && open && <Guide platform={platform} />}
      {!compact && !open && (
        <span className="note">
          {canPrompt ? 'แอปจะมีไอคอนบนหน้าจอหลัก เปิดแบบเต็มจอเหมือนแอปทั่วไป · Adds an icon to your home screen'
            : 'กดปุ่มเพื่อดูวิธีติดตั้งสำหรับเครื่องนี้ · Tap for the steps for this phone'}
        </span>
      )}
    </div>
  );
}

const DISMISS_DAYS = 14;
/** Banner on phones that are not yet using the installed app; "Later" hides it for two weeks. */
export function InstallBanner() {
  const path = usePathname();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const p = detect();
    let until = 0;
    try { until = Number(localStorage.getItem('qa-install-later') || 0); } catch { /* storage blocked */ }
    setShow((p === 'ios' || p === 'android') && Date.now() > until);
  }, []);
  // the account page has the install card itself
  if (!show || path.startsWith('/profile')) return null;
  const close = () => {
    try { localStorage.setItem('qa-install-later', String(Date.now() + DISMISS_DAYS * 864e5)); } catch { /* ignore */ }
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
