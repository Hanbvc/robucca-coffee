# Robucca — Prototipe Pemesanan & Reservasi

Prototipe web app mobile untuk **Robucca Ijen Nirwana, Malang** (Rbc Group). Pelanggan bisa pesan **Pick Up** (pesan dulu, ambil tanpa antre), pesan **Delivery** yang diantar GoSend / GrabExpress, bayar QRIS, dan reservasi meja langsung dari ponsel tanpa mengunduh aplikasi. UI/UX sama dengan prototipe monograph., dengan warna, huruf, logo, dan foto dari buku menu Robucca 2026.

> **Prototipe untuk demo.** Belum terhubung ke sistem kasir, payment gateway, maupun API GoSend / GrabExpress. QR pembayaran, ongkir, data driver, dan status pesanan masih simulasi, jadi jangan memindai QR untuk membayar.

**Coba langsung (paling nyaman di ponsel):** https://hanbvc.github.io/robucca-coffee/

## Struktur baru (Project Nectar, sesuai PRD)

Repo ini sedang dipindah ke monorepo sesuai PRD *Robbucca Unified POS & PWA System*. Kode lama di root tetap jalan dan menjadi acuan porting, dan GitHub Pages masih menayangkan prototipe lama.

| Folder | Isi | Status |
| --- | --- | --- |
| `apps/api` | Backend NestJS: API kasir (pasang perangkat, PIN, shift, jual, void/refund, sinkron offline, potong stok BoM), API kantor ([kontrak](apps/api/docs/office-api.md)), API pelanggan (menu, pesanan, reservasi, login WhatsApp, status pesanan real-time) | Jalan, ada tes |
| `apps/pos` | Kasir React + Vite + Tailwind, offline-first, siap Electron: kasir, tagihan, riwayat, shift, layar dapur, layar antrean, kantor | Jalan, diuji di browser |
| `apps/pwa` | Aplikasi pelanggan Next.js (ekspor statis): semua fitur prototipe lama, ditambah login WhatsApp, alamat tersimpan, dan menu baca-saja di `/daftar-menu/` | Jalan, diuji di browser |
| `packages/core` | Hitungan harga, opsi, dan pajak bersama | |
| `packages/db` | Prisma + PostgreSQL, skema bersama, migrasi, seed | Disetujui sementara; seed dari data lama ([docs/schema-review.md](docs/schema-review.md)) |
| `pos/`, `server/`, `index.html`, `js/`, `menu/` | POS dan PWA lama | Acuan, tidak diubah |

```bash
corepack enable && pnpm install
pnpm typecheck && pnpm build   # semua app
npm test                       # tes POS lama

# Database (PostgreSQL 16+). Isi DATABASE_URL, contoh di packages/db/.env.example
export DATABASE_URL=postgresql://robucca:password@localhost:5432/robucca
pnpm db:deploy                 # jalankan migrasi
pnpm db:seed                   # isi menu, cabang IJN, kanal, metode bayar dari data lama
SEED_DEMO=1 pnpm db:seed       # + 3 cabang contoh & staf contoh (PIN 1111/2222/3333/4444), khusus dev
SEED_OWNER_PIN=123456 pnpm db:seed   # + akun pemilik (Super Admin)

pnpm --filter @robucca/api dev # API di http://localhost:3000 (coba /branches/IJN/menu)
pnpm --filter @robucca/pos dev # kasir & kantor, /api diteruskan ke API
pnpm --filter @robucca/pwa dev # aplikasi pelanggan di http://localhost:3001
```

Data seed masih **sementara** dari prototipe lama (`js/data.js` dan bawaan POS lama). Bahan baku & resep (BoM) belum diisi karena datanya masih disiapkan. Pajak cabang memakai bawaan POS lama (PB1 10% sudah termasuk harga); ubah setelah dikonfirmasi.

### Aplikasi pelanggan (`apps/pwa`)

Hasil build adalah situs statis (`apps/pwa/out/`), jadi bisa di-hosting di mana saja (GitHub Pages, Netlify, nginx). Semua data diambil dari API, sehingga API harus bisa dijangkau dari internet dan origin situs ini dimasukkan ke `CORS_ORIGINS`.

```bash
NEXT_PUBLIC_API_URL=https://api.contoh.id pnpm --filter @robucca/pwa build
node apps/pwa/scripts/serve.mjs 3001   # coba hasil build secara lokal
```

- **Pembayaran jujur.** Prototipe lama menandai pesanan lunas saat pelanggan menekan "Saya sudah bayar". Sekarang pesanan QRIS menunggu kasir mengonfirmasi pembayaran di kasir, lalu status di aplikasi berubah sendiri. Gambar QRIS statis per cabang diunggah di Kantor → Cabang; tanpa gambar, pelanggan meminta QRIS lewat WhatsApp atau memilih bayar di kasir.
- **Delivery.** Kurir dipesan kasir lewat aplikasi GoSend / GrabExpress (belum ada integrasi API). Alamat, penerima, dan tautan Google Maps tampil di kasir (Riwayat → Delivery; lencana di menu Riwayat menghitung delivery yang belum berangkat). Saat driver mengambil pesanan, kasir menekan **Driver berangkat** lalu mengisi nama, plat, nomor, perkiraan tiba, dan tautan lacak dari aplikasi kurir; pelanggan langsung melihat "Sedang diantar" beserta data driver. Pesanan selesai saat pelanggan menandai diterima atau kasir menekan **Pesanan tiba**.
- **Login WhatsApp** memakai kode 6 digit yang dikirim gateway WhatsApp (`OTP_WEBHOOK_URL`). Tanpa gateway, di produksi login dimatikan dan pelanggan tetap bisa memesan sebagai tamu.
- **Offline.** Service worker menyimpan halaman tab dan skripnya, jadi aplikasi tetap terbuka saat sinyal hilang (menu dari data terakhir). Pesanan, pembayaran, dan status tidak pernah diambil dari cache.
- **Tautan lama** prototipe (`#/menu`, `#/status/…`, dll.) dialihkan ke halaman barunya.
- Uji browser menyeluruh (aplikasi pelanggan + kasir, 12 alur): lihat cara menjalankannya di kepala [apps/pwa/e2e/pwa-e2e.cjs](apps/pwa/e2e/pwa-e2e.cjs). Tangkapan layarnya ada di `apps/pwa/docs/screenshots/`.

### Pengaturan (environment)

| Variabel | App | Isi |
| --- | --- | --- |
| `DATABASE_URL` | api, db | PostgreSQL |
| `AUTH_SECRET` | api | Kunci token, min. 32 karakter. **Wajib di produksi.** |
| `CORS_ORIGINS` | api | Origin yang boleh memanggil API, dipisah koma: aplikasi pelanggan dan kasir/kantor bila beda origin |
| `TRUST_PROXY` | api | Isi bila API di belakang reverse proxy (nginx, load balancer), mis. `loopback`, agar batas per IP memakai IP pelanggan |
| `OTP_WEBHOOK_URL`, `OTP_WEBHOOK_SECRET` | api | Gateway WhatsApp pengirim kode login |
| `PUBLIC_ORDER_IP_LIMIT`, `PUBLIC_OTP_IP_LIMIT`, `PUBLIC_RSV_IP_LIMIT` | api | Batas per IP: pesanan (bawaan 20 per 10 menit), kode login (10 per 10 menit), reservasi (10 per jam) |
| `PORT` | api | Bawaan 3000 |
| `VITE_API_URL` | pos | Alamat API (bawaan `/api` lewat proxy) |
| `VITE_PWA_URL` | pos | Alamat aplikasi pelanggan, untuk tautan menu per cabang di Kantor → Menu |
| `NEXT_PUBLIC_API_URL` | pwa | Alamat API, dibaca saat build |
| `NEXT_PUBLIC_BASE_PATH` | pwa | Sub-path hosting, mis. `/robucca-coffee/app` di GitHub Pages |
| `NEXT_PUBLIC_SITE_URL` | pwa | Origin situs untuk pratinjau tautan, mis. `https://hanbvc.github.io` |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | pwa | Cari alamat delivery lewat Google Maps. Batasi kuncinya ke domain situs di Google Cloud. Tanpa kunci, pelanggan memakai lokasi perangkat atau menempel tautan Maps |
| `NEXT_PUBLIC_DEMO` | pwa | `1` = alamat & penerima contoh terisi otomatis seperti prototipe. Jangan dipakai di produksi |

## Sistem kasir (POS) multi-cabang

Folder [`pos/`](pos/) berisi sistem kasir untuk semua cabang: kasir (tablet/PC), layar dapur/bar, layar antrean, dan kantor pusat (dasbor & laporan lintas cabang, menu & harga per cabang, stok, promo, karyawan, perangkat). Bisa dicoba tanpa server di `/pos/` (mode demo, data di browser), atau dijalankan dengan server pusat (`npm start`, Node.js 22.13+) agar semua cabang memakai satu database dan tetap bisa berjualan saat offline. Panduan lengkap: [pos/README.md](pos/README.md).

## Menu untuk pelanggan

Halaman [`menu/`](menu/) adalah menu yang bisa dilihat pelanggan tanpa memesan, untuk QR di meja, tautan di bio Instagram, atau tablet/TV di kasir. Urutannya **Minuman → Snack → Makanan Berat → Pastry & Dessert**, sama dengan aplikasi pemesanan dan kasir POS. Ada tab kelompok, chip kategori, pencarian, keterangan ukuran/penyajian (mis. *Iced · Large +4.000*, *Hot +2.000*), dan tanda **Habis**.

- **Tanpa server** (mis. GitHub Pages): menampilkan menu standar dari `js/data.js`.
- **Dari server POS** (`https://alamat-server/menu/?cabang=IJN`): harga khusus dan ketersediaan cabang itu, diperbarui tiap menit. Tautan setiap cabang ada di POS › Kantor › Menu & harga › **Menu pelanggan**. Di mode demo, tombol **Pratinjau** di sana menampilkan menu pelanggan dengan data demo cabang tersebut.
- Agar menu di GitHub Pages ikut membaca server POS, isi `posServer` di `js/data.js`.

## Fitur

- **Menu lengkap:** 95 menu dalam 15 kategori dengan foto dari buku menu, diurutkan per kelompok: **Minuman** (Robucca Essentials, Signature, Coffee, Milk, Tea, Soda) → **Snack** → **Makanan Berat** (Ramen, Bento, Rice Bowl, Breakfast & Sandwich, Salad, Pasta) → **Pastry & Dessert**.
- **Ukuran & penyajian:** minuman dingin punya pilihan Regular/Large. Menu yang tersedia panas dan dingin (Caffe Latte, Cappuccino, Americano, Mochaccino, Green Tea, Red Velvet) digabung jadi satu, dan fotonya ikut berganti saat memilih Hot.
- **Pick Up:** pesan dan bayar dari ponsel, pilih jam ambil (secepatnya atau terjadwal), lalu ambil di counter pick-up tanpa antre dengan menyebut nama atau kode pesanan.
- **Delivery:** kartu rute toko → alamat tujuan (jarak & status jangkauan, layar "Di Luar Jangkauan" bila lebih dari batas), cari alamat lewat Google Maps (saran alamat + peta) atau pakai lokasi pelanggan, pilih GoSend Instant atau GrabExpress Instant dengan estimasi ongkir dan waktu tiba, bayar online (termasuk ongkir), lalu pantau status sampai driver mengantar.
- **Checkout:** QRIS, GoPay, OVO, DANA, ShopeePay, atau bayar di kasir (khusus Pick Up dan pre-order; Delivery wajib bayar online). Harga sesuai buku menu (tanpa tambahan pajak di aplikasi).
- **Status pesanan, reservasi meja, pre-order, konfirmasi WhatsApp**, dan optimasi iPhone (PWA, safe area, keyboard, haptic, layar pembuka).

## Menjalankan di komputer sendiri

```bash
python3 -m http.server 5174
```

Lalu buka http://localhost:5174 (atau `http://<IP-komputer>:5174` dari ponsel di Wi-Fi yang sama).

## Mengubah data

Semua data toko ada di `js/data.js`:

| Bagian | Isi |
| --- | --- |
| `MG_CONFIG` | Nama, alamat, jam buka, WhatsApp, Instagram, peta, pajak, teks beranda, foto suasana, tarif & jangkauan delivery (`delivery`), alamat server POS untuk menu pelanggan (`posServer`) |
| `MG_GROUPS` | Kelompok menu dan urutannya: Minuman → Snack → Makanan Berat → Pastry & Dessert (harus sama dengan `pos/js/core/menu.js`; diperiksa tes) |
| `MG_MENU` | Kategori (urut per kelompok), menu, harga, dan pilihan (ukuran, gula, es) |
| `MG_BANNERS` | Banner di beranda dan kategori yang dibuka |

Kalau Robucca menambahkan pajak/servis di kasir, isi `taxRate` (misalnya `0.10`) dan `taxLabel` (misalnya `"PB1 10%"`); harga dan ringkasan pembayaran akan menyesuaikan.

## Pencarian alamat Google Maps

Kolom alamat delivery memakai Google Maps:

- **Tanpa API key** (bawaan): alamat yang diketik ditampilkan di peta Google Maps. Jarak & ongkir dihitung dari tombol "Pakai lokasi saya" (atau estimasi bila belum ada).
- **Dengan API key**: muncul daftar saran alamat dari Google Places; begitu dipilih, titik, jarak, dan ongkir dihitung otomatis.

Cara mengaktifkan saran alamat:

1. Di [Google Cloud Console](https://console.cloud.google.com/), buat project dan aktifkan billing.
2. Aktifkan **Maps JavaScript API** dan **Places API (New)**.
3. Buat API key, lalu batasi (*Application restrictions → Websites*) ke `https://hanbvc.github.io/*` dan `http://localhost:5174/*`, serta batasi API-nya ke dua API di atas.
4. Isi key tersebut di `googleMapsKey` pada `js/data.js`.

## Catatan

- Untuk demo, pengunjung baru otomatis memakai alamat & penerima contoh di Jl. Soekarno Hatta (Suhat), Malang, dengan nomor WhatsApp contoh. Ubah atau hapus di `delivery.sample` pada `js/data.js`.

- Ongkir delivery dihitung dari `delivery.couriers` (tarif dasar + per km, minimum, dibulatkan ke Rp500) dengan jangkauan maksimal `delivery.maxKm`. Ini estimasi; di versi final ongkir, pemesanan driver, dan pelacakan diambil dari API GoSend dan GrabExpress.

- Pesanan dan reservasi tersimpan di perangkat masing-masing (localStorage); belum ada backend.
- Status pesanan bergerak otomatis untuk keperluan demo.
- Logo, foto menu, dan konten merek adalah milik Robucca / Rbc Group dan dipakai hanya untuk keperluan demo prototipe ini.
