'use client';
import { useApp } from '@/components/AppProvider';
import { ProductList } from '@/components/ProductList';

/** SKU product list for preparers and approvers: look up only; admins can edit here too. */
export default function Page() {
  const { has } = useApp();
  if (!(has('preparer') || has('approver') || has('admin')))
    return (
      <div className="card">
        <h1>ไม่มีสิทธิ์ดูหน้านี้</h1>
        <p className="lead">รายการสินค้าเปิดให้ผู้จัดทำ ผู้อนุมัติ และผู้ดูแลระบบ · Preparers, approvers and admins only.</p>
      </div>
    );
  return <ProductList canEdit={has('admin')} />;
}
