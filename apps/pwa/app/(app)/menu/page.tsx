import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MenuScreen } from '@/components/screens/MenuScreen';

export const metadata: Metadata = { title: 'Menu' };

export default function Page() {
  return (
    <Suspense fallback={<div className="screen" />}>
      <MenuScreen />
    </Suspense>
  );
}
