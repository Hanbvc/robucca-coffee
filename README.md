# Robucca — Prototipe Pemesanan & Reservasi

Prototipe web app mobile untuk **Robucca Ijen Nirwana, Malang** (Rbc Group). Pelanggan bisa pesan **Pick Up** (pesan dulu, ambil tanpa antre), pesan **Delivery** yang diantar GoSend / GrabExpress, bayar QRIS, dan reservasi meja langsung dari ponsel tanpa mengunduh aplikasi. UI/UX sama dengan prototipe monograph., dengan warna, huruf, logo, dan foto dari buku menu Robucca 2026.

> **Prototipe untuk demo.** Belum terhubung ke sistem kasir, payment gateway, maupun API GoSend / GrabExpress. QR pembayaran, ongkir, data driver, dan status pesanan masih simulasi, jadi jangan memindai QR untuk membayar.

**Coba langsung (paling nyaman di ponsel):** https://hanbvc.github.io/robucca-coffee/

## Sistem kasir (POS) multi-cabang

Folder [`pos/`](pos/) berisi sistem kasir untuk semua cabang: kasir (tablet/PC), layar dapur/bar, layar antrean, dan kantor pusat (dasbor & laporan lintas cabang, menu & harga per cabang, stok, promo, karyawan, perangkat). Bisa dicoba tanpa server di `/pos/` (mode demo, data di browser), atau dijalankan dengan server pusat (`npm start`, Node.js 22.13+) agar semua cabang memakai satu database dan tetap bisa berjualan saat offline. Panduan lengkap: [pos/README.md](pos/README.md).

## Fitur

- **Menu lengkap:** 95 menu dalam 15 kategori (Ramen, Bento, Rice Bowl, Snack, Pastry, Dessert, Coffee, Milk, Tea, Soda, dan lainnya) dengan foto dari buku menu.
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
| `MG_CONFIG` | Nama, alamat, jam buka, WhatsApp, Instagram, peta, pajak, teks beranda, foto suasana, tarif & jangkauan delivery (`delivery`) |
| `MG_MENU` | Kategori, menu, harga, dan pilihan (ukuran, gula, es) |
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
