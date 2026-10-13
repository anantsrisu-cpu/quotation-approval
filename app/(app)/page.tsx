'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/AppProvider';
import { Loading } from '@/components/ui';

/** Home: send each person to the page for their main role. */
export default function Home() {
  const { me, has } = useApp();
  const router = useRouter();
  useEffect(() => {
    if (!me || me.status !== 'active') return;
    if (has('approver') && !has('preparer')) router.replace('/inbox');
    else if (has('preparer')) router.replace('/requests');
    else if (has('admin')) router.replace('/admin');
    else router.replace('/history');
  }, [me, has, router]);
  return <Loading rows={2} />;
}
