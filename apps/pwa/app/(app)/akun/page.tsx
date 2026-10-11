import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Akun } from '@/components/screens/Akun';

export const metadata: Metadata = { title: 'Akun' };

export default function Page() {
  return (
    <Suspense fallback={<div className="screen" />}>
      <Akun />
    </Suspense>
  );
}
