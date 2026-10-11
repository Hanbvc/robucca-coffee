/* Layout akar menu baca-saja (/daftar-menu/): ringan, tanpa tab bar & keranjang aplikasi, gaya sendiri (menu/menu.css prototipe). */
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../styles/daftar-menu.css';

const BASE = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

export const metadata: Metadata = {
  title: 'Menu Robucca',
  description: 'Menu Robucca: minuman, snack, makanan berat, serta pastry & dessert — harga dan ketersediaan per cabang.',
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, date: false, address: false, email: false },
  icons: { icon: `${BASE}/assets/brand/favicon.png`, apple: `${BASE}/assets/brand/apple-touch-icon.png` },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FAEEDA',
  colorScheme: 'light',
};

export default function MenuLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Londrina+Solid:wght@400;900&family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <noscript>
          <p style={{ padding: 24, textAlign: 'center' }}>Aktifkan JavaScript untuk melihat menu.</p>
        </noscript>
      </body>
    </html>
  );
}
