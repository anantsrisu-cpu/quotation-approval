'use client';
import { useApp } from './AppProvider';

export function AdminGate({ children }: { children: React.ReactNode }) {
  const { has } = useApp();
  if (!has('admin'))
    return (
      <div className="card">
        <h1>เฉพาะผู้ดูแลระบบ</h1>
        <p className="lead">Admins only. Ask an admin if you need access to this page.</p>
      </div>
    );
  return <>{children}</>;
}
