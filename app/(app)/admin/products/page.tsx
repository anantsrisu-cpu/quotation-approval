'use client';
import { AdminGate } from '@/components/AdminGate';
import { ProductList } from '@/components/ProductList';

export default function Page() {
  return <AdminGate><ProductList canEdit /></AdminGate>;
}
