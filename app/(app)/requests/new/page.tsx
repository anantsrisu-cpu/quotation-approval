'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { RequestForm } from '@/components/RequestForm';
import { useApp } from '@/components/AppProvider';
import { Loading } from '@/components/ui';

function Inner() {
  const p = useSearchParams();
  const { has } = useApp();
  if (!has('preparer')) return <div className="card"><h1>ต้องมีสิทธิ์ผู้จัดทำ</h1><p className="lead">You need the preparer role to create requests. Ask the admin.</p></div>;
  const id = p.get('id');
  const copy = p.get('copy');
  return <RequestForm key={id || copy || 'new'} draftId={id} copyFrom={copy} />;
}

export default function NewRequestPage() {
  return (
    <Suspense fallback={<Loading rows={5} />}>
      <Inner />
    </Suspense>
  );
}
