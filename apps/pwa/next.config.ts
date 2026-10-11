import type { NextConfig } from 'next';

/* Aplikasi pelanggan diekspor statis (folder out/): bisa dihosting di mana saja — GitHub Pages, Netlify,
   Cloudflare Pages, atau nginx di samping API. Semua data diambil dari API (NEXT_PUBLIC_API_URL) di browser,
   jadi API harus mengizinkan origin aplikasi ini lewat CORS_ORIGINS.
   NEXT_PUBLIC_BASE_PATH: sub-path hosting, mis. "/robucca-coffee/app" untuk GitHub Pages proyek. */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  ...(basePath ? { basePath } : {}),
  reactStrictMode: true,
  images: { unoptimized: true },
  // Indikator dev menutupi tab bar di layar ponsel saat diuji.
  devIndicators: false,
  // Dua layout akar (aplikasi & menu baca-saja) → halaman 404 global sendiri.
  experimental: { globalNotFound: true },
};

export default nextConfig;
