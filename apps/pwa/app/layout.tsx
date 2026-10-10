import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Robucca — pesan & ambil',
  description: 'Pesan dari ponsel, ambil di cabang Robucca pilihanmu tanpa antre.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FAEEDA',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body className="bg-cream text-brand antialiased">{children}</body>
    </html>
  );
}
