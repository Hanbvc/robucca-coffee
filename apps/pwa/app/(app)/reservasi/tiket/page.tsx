import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Ticket } from '@/components/screens/Ticket';

export const metadata: Metadata = { title: 'Tiket reservasi' };

export default function Page() {
  return (
    <Suspense fallback={<div className="screen" />}>
      <Ticket />
    </Suspense>
  );
}
