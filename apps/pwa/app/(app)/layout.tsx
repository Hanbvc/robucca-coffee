import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { DeskBranch } from '@/components/DeskBranch';
import { Shell } from '@/components/Shell';
import './globals.css';

const BASE = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
const a = (p: string): string => `${BASE}/${p}`;

/** Origin situs untuk URL gambar pratinjau tautan (Open Graph). Path sudah memuat basePath, jadi cukup origin-nya. */
function siteOrigin(): URL | undefined {
  try {
    return process.env.NEXT_PUBLIC_SITE_URL ? new URL(new URL(process.env.NEXT_PUBLIC_SITE_URL).origin) : undefined;
  } catch {
    return undefined;
  }
}

/** Layar pembuka saat dibuka dari Home Screen iPhone (sama dengan index.html prototipe). */
const SPLASH: [number, number, number, string][] = [
  [440, 956, 3, '1320x2868'],
  [430, 932, 3, '1290x2796'],
  [420, 912, 3, '1260x2736'],
  [402, 874, 3, '1206x2622'],
  [393, 852, 3, '1179x2556'],
  [390, 844, 3, '1170x2532'],
  [428, 926, 3, '1284x2778'],
  [375, 812, 3, '1125x2436'],
  [414, 896, 3, '1242x2688'],
  [414, 896, 2, '828x1792'],
  [414, 736, 3, '1242x2208'],
  [375, 667, 2, '750x1334'],
];

export const metadata: Metadata = {
  metadataBase: siteOrigin(),
  title: { default: 'Robucca — pesan & reservasi', template: '%s · Robucca' },
  description: 'Pesan pick up tanpa antre, delivery GoSend/Grab, lihat menu lengkap, dan reservasi meja di cabang Robucca pilihanmu.',
  applicationName: 'Robucca',
  formatDetection: { telephone: false, date: false, address: false, email: false },
  appleWebApp: {
    capable: true,
    title: 'Robucca',
    statusBarStyle: 'default',
    startupImage: SPLASH.map(([w, h, r, f]) => ({
      url: a(`assets/splash/splash-${f}.png`),
      media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
    })),
  },
  icons: { icon: a('assets/brand/favicon.png'), apple: a('assets/brand/apple-touch-icon.png') },
  openGraph: {
    title: 'Robucca — pesan & reservasi',
    description: 'Pesan pick up tanpa antre, delivery GoSend/Grab, dan reservasi meja di Robucca.',
    images: [a('assets/img/banner-essentials.jpg')],
  },
  other: { 'apple-mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FAEEDA',
  colorScheme: 'light',
};

/* Sebelum tampil: kelas iPhone/standalone (CSS ruang aman) & splash hanya sekali per sesi. */
const BOOT = `(function(){try{var d=document.documentElement,n=navigator,u=n.userAgent;
var ios=/iP(hone|od|ad)/.test(n.platform)||/iPhone|iPod/.test(u)||(u.indexOf('Mac')>-1&&n.maxTouchPoints>1);
var sa=n.standalone===true||(window.matchMedia&&matchMedia('(display-mode: standalone)').matches);
if(ios)d.classList.add('ios');if(sa)d.classList.add('standalone');
var k='rbc:splash';if(sessionStorage.getItem(k)==='1')d.classList.add('no-splash');else sessionStorage.setItem(k,'1');
}catch(e){}})();`;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Londrina+Solid:wght@400;900&family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {/* Panel samping (hanya tampil di layar lebar) */}
        <aside className="desk" aria-hidden="true">
          <img className="desk-logo" src={a('assets/brand/lockup-dark.png')} alt="" />
          <p className="desk-lead">Pesan pick up tanpa antre, delivery, dan reservasi meja — langsung dari ponsel.</p>
          <p className="desk-note">Tampilan ini dirancang untuk handphone. Buka di ponsel untuk pengalaman terbaik.</p>
          <DeskBranch />
        </aside>
        <div id="splash" className="splash" aria-hidden="true">
          <img src={a('assets/brand/wordmark-light.png')} alt="" />
        </div>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
