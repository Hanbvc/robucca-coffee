import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Pesanan } from '@/components/screens/Pesanan';

export const metadata: Metadata = { title: 'Aktivitas' };

export default function Page() {
  return (
    <Suspense fallback={<div className="screen" />}>
      <Pesanan />
    </Suspense>
  );
}
