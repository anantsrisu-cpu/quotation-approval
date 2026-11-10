'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp } from './AppProvider';
import type { RequestRow } from '@/lib/types';

/**
 * Edit a request in place (keeps its number and history).
 * A draft opens the form; a sent request can be edited only after an approver rejects it
 * (it goes back to draft, then the form opens). Requests waiting for approval cannot be changed.
 */
export function EditRequestButton({ r, sm }: { r: Pick<RequestRow, 'id' | 'no' | 'status'>; sm?: boolean }) {
  const { sb, run } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const cls = `btn o${sm ? ' sm' : ''}`;
  const form = `/requests/new?id=${r.id}`;

  if (r.status === 'draft') return <Link className={cls} href={form} id={`edit-${r.id}`}>แก้ไข · Edit</Link>;
  if (r.status !== 'rejected') return null;

  async function reopen() {
    setBusy(true);
    const { ok } = await run('reopen_request', sb.rpc('reopen_request', { p_id: r.id }));
    setBusy(false);
    if (ok) router.push(form);
  }
  return <button type="button" className={cls} id={`edit-${r.id}`} disabled={busy} onClick={reopen}>แก้ไขและส่งใหม่ · Edit &amp; resend</button>;
}
