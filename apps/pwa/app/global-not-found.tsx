/* Halaman 404 untuk semua alamat yang tidak dikenal (aplikasi punya dua layout akar: aplikasi & menu baca-saja). */
import type { Metadata } from 'next';
import './(app)/globals.css';

const BASE = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

export const metadata: Metadata = { title: 'Halaman tidak ditemukan · Robucca' };

export default function GlobalNotFound() {
  return (
    <html lang="id">
      <body className="sub">
        <div className="app">
          <div className="empty" style={{ paddingTop: 120 }}>
            <img src={`${BASE}/assets/brand/wordmark-dark.png`} alt="Robucca" style={{ height: 36, width: 'auto', margin: '0 auto 22px' }} />
            <h3>Halaman tidak ditemukan</h3>
            <p>Alamat ini tidak ada. Kembali ke beranda untuk pesan atau reservasi.</p>
            <a className="btn" href={`${BASE}/`}>
              Ke beranda
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
