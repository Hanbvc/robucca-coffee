/* Manifes aplikasi (Pasang di layar utama). Sama dengan manifest.webmanifest prototipe; path mengikuti basePath. */
import type { MetadataRoute } from 'next';

const BASE = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Robucca — Pesan & Reservasi',
    short_name: 'Robucca',
    description: 'Pesan pick up tanpa antre, delivery GoSend/Grab, dan reservasi meja di cabang Robucca pilihanmu.',
    id: `${BASE}/`,
    start_url: `${BASE}/`,
    scope: `${BASE}/`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#01512C',
    theme_color: '#FAEEDA',
    lang: 'id',
    icons: [
      { src: `${BASE}/assets/brand/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${BASE}/assets/brand/icon-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${BASE}/assets/brand/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
