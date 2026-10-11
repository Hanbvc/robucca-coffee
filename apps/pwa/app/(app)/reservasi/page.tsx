import type { Metadata } from 'next';
import { Reservasi } from '@/components/screens/Reservasi';

export const metadata: Metadata = { title: 'Reservasi meja' };

export default function Page() {
  return <Reservasi />;
}
