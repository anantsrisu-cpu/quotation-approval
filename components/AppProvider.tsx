'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import { reportError } from '@/lib/errors';
import { errText } from '@/lib/format';
import type { Company, Department, Notification, Position, Profile, Role, Settings, Tier } from '@/lib/types';

type ToastType = 'ok' | 'bad' | 'info';
interface Toast { id: number; type: ToastType; title: string; body?: string }

interface AppCtx {
  sb: SupabaseClient;
  uid: string | null;
  me: Profile | null;
  ready: boolean;
  settings: Settings | null;
  positions: Position[];
  tiers: Tier[];
  departments: Department[];
  companies: Company[];
  people: Record<string, Profile>;
  notifs: Notification[];
  unread: number;
  waitingCount: number;
  bump: number;
  refresh: () => void;
  reloadRefs: () => Promise<void>;
  reloadMe: () => Promise<void>;
  toast: (type: ToastType, title: string, body?: string) => void;
  has: (r: Role) => boolean;
  name: (id?: string | null) => string;
  deptTh: (id?: string | null) => string;
  posTh: (code?: string | null) => string;
  company: (id?: string | null) => Company | null;
  logoUrl: (c: Company | null) => string | null;
  markRead: (ids?: number[]) => Promise<void>;
  /** Run a Supabase call; on failure show a toast and log it to the admin bug list. */
  run: <T = any>(action: string, op: PromiseLike<{ data: any; error: any }>) => Promise<{ ok: boolean; data: T | null }>;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp must be used inside <AppProvider>');
  return c;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const sb = getSupabase();
  const [uid, setUid] = useState<string | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [people, setPeople] = useState<Record<string, Profile>>({});
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [waitingCount, setWaitingCount] = useState(0);
  const [bump, setBump] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((type: ToastType, title: string, body?: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, type, title, body }]);
    if (type !== 'bad') setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500);
  }, []);

  const run = useCallback(
    async <T,>(action: string, op: PromiseLike<{ data: any; error: any }>): Promise<{ ok: boolean; data: T | null }> => {
      try {
        const { data, error } = await op;
        if (error) {
          const msg = errText(error);
          toast('bad', 'ทำรายการไม่สำเร็จ · Action failed', msg);
          // business-rule messages (Thai · English) are expected; log only unexpected ones
          if (!/ · /.test(error.message || '')) reportError(error.message || String(error), { action, detail: JSON.stringify(error) });
          return { ok: false, data: null };
        }
        return { ok: true, data: data as T };
      } catch (e: any) {
        toast('bad', 'ทำรายการไม่สำเร็จ · Action failed', errText(e));
        reportError(e?.message || String(e), { action, detail: e?.stack || '' });
        return { ok: false, data: null };
      }
    },
    [toast],
  );

  const reloadMe = useCallback(async () => {
    const { data: u } = await sb.auth.getUser();
    const id = u.user?.id || null;
    setUid(id);
    if (!id) {
      setMe(null);
      return;
    }
    const { data } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
    setMe((data as Profile) || null);
  }, [sb]);

  const reloadRefs = useCallback(async () => {
    const [s, p, t, d, c, pp] = await Promise.all([
      sb.from('app_settings').select('*').eq('id', 1).maybeSingle(),
      sb.from('positions').select('*').order('sort'),
      sb.from('tiers').select('*').order('sort'),
      sb.from('departments').select('*').order('sort'),
      sb.from('companies').select('*').order('sort'),
      sb.from('profiles').select('*').order('name'),
    ]);
    setSettings((s.data as Settings) || null);
    setPositions((p.data as Position[]) || []);
    setTiers((t.data as Tier[]) || []);
    setDepartments((d.data as Department[]) || []);
    setCompanies((c.data as Company[]) || []);
    const map: Record<string, Profile> = {};
    ((pp.data as Profile[]) || []).forEach((x) => (map[x.id] = x));
    setPeople(map);
  }, [sb]);

  const loadNotifs = useCallback(async (id: string) => {
    const { data } = await sb.from('notifications').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(30);
    setNotifs((data as Notification[]) || []);
    const { count } = await sb
      .from('request_steps')
      .select('id', { count: 'exact', head: true })
      .eq('approver_id', id)
      .eq('status', 'pending');
    setWaitingCount(count || 0);
  }, [sb]);

  // initial load
  useEffect(() => {
    let alive = true;
    (async () => {
      await reloadMe();
      await reloadRefs();
      if (alive) setReady(true);
    })();
    const { data: sub } = sb.auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_OUT') window.location.href = '/login';
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [sb, reloadMe, reloadRefs]);

  // notifications: initial + live
  useEffect(() => {
    if (!uid || me?.status !== 'active') return;
    loadNotifs(uid);
    const ch = sb
      .channel('notif-' + uid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, (payload) => {
        const n = payload.new as Notification;
        setNotifs((list) => [n, ...list.filter((x) => x.id !== n.id)].slice(0, 30));
        toast(n.kind === 'bad' ? 'bad' : n.kind === 'ok' ? 'ok' : 'info', n.title, n.body);
        setBump((b) => b + 1);
      })
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [sb, uid, me?.status, loadNotifs, toast]);

  useEffect(() => {
    if (uid && me?.status === 'active' && bump > 0) loadNotifs(uid);
  }, [bump, uid, me?.status, loadNotifs]);

  // send unexpected browser errors to the admin bug list
  useEffect(() => {
    const onErr = (e: ErrorEvent) => reportError(e.message || 'Script error', { action: 'window.onerror', detail: e.error?.stack || `${e.filename}:${e.lineno}` });
    const onRej = (e: PromiseRejectionEvent) => {
      const r: any = e.reason;
      reportError(r?.message || String(r), { action: 'unhandledrejection', detail: r?.stack || '' });
    };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);

  const markRead = useCallback(
    async (ids?: number[]) => {
      if (!uid) return;
      const now = new Date().toISOString();
      let q = sb.from('notifications').update({ read_at: now }).eq('user_id', uid).is('read_at', null);
      if (ids && ids.length) q = q.in('id', ids);
      await q;
      setNotifs((list) => list.map((n) => (!n.read_at && (!ids || ids.includes(n.id)) ? { ...n, read_at: now } : n)));
    },
    [sb, uid],
  );

  const value = useMemo<AppCtx>(() => {
    const has = (r: Role) => !!me && me.status === 'active' && me.roles.includes(r);
    return {
      sb, uid, me, ready, settings, positions, tiers, departments, companies, people, notifs,
      unread: notifs.filter((n) => !n.read_at).length,
      waitingCount, bump,
      refresh: () => setBump((b) => b + 1),
      reloadRefs, reloadMe, toast, has, run, markRead,
      name: (id) => (id && people[id] ? people[id].name || people[id].email : '—'),
      deptTh: (id) => departments.find((d) => d.id === id)?.th || id || '—',
      posTh: (code) => positions.find((p) => p.code === code)?.th || code || '—',
      company: (id) => companies.find((c) => c.id === id) || companies[0] || null,
      logoUrl: (c) => (c?.logo_path ? sb.storage.from('logos').getPublicUrl(c.logo_path).data.publicUrl : null),
    };
  }, [sb, uid, me, ready, settings, positions, tiers, departments, companies, people, notifs, waitingCount, bump, reloadRefs, reloadMe, toast, run, markRead]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite">
        {toasts.slice(-1).map((t) => (
          <div key={t.id} className={`toast ${t.type}`} role={t.type === 'bad' ? 'alert' : 'status'}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{t.title}</b>
              {t.body && <span style={{ fontSize: 13 }}>{t.body}</span>}
            </div>
            <button
              className="icon-btn"
              style={{ width: 36, height: 36, background: 'transparent', border: 'none' }}
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
              aria-label="ปิด · Close"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
