import type { Metadata } from 'next';
import { Checkout } from '@/components/screens/Checkout';

export const metadata: Metadata = { title: 'Keranjang' };

export default function Page() {
  return <Checkout />;
}
