import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrderStatus } from '@/components/screens/OrderStatus';

export const metadata: Metadata = { title: 'Status pesanan' };

export default function Page() {
  return (
    <Suspense fallback={<div className="screen" />}>
      <OrderStatus />
    </Suspense>
  );
}
