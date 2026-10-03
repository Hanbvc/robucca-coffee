# Robucca — Prototipe Pemesanan & Reservasi

Prototipe web app mobile untuk **Robucca Ijen Nirwana, Malang** (Rbc Group). Pelanggan bisa pesan dine in lewat QR meja, pesan take away, bayar QRIS, dan reservasi meja langsung dari ponsel tanpa mengunduh aplikasi. UI/UX sama dengan prototipe monograph., dengan warna, huruf, logo, dan foto dari buku menu Robucca 2026.

> **Prototipe untuk demo.** Belum terhubung ke sistem kasir maupun payment gateway Robucca. QR pembayaran dan status pesanan masih simulasi, jadi jangan memindai QR untuk membayar.

**Coba langsung (paling nyaman di ponsel):** https://hanbvc.github.io/robucca-coffee/

Contoh link QR meja (otomatis masuk mode dine in, meja 12): https://hanbvc.github.io/robucca-coffee/?meja=12

## Fitur

- **Menu lengkap:** 95 menu dalam 15 kategori (Ramen, Bento, Rice Bowl, Snack, Pastry, Dessert, Coffee, Milk, Tea, Soda, dan lainnya) dengan foto dari buku menu.
- **Ukuran & penyajian:** minuman dingin punya pilihan Regular/Large. Menu yang tersedia panas dan dingin (Caffe Latte, Cappuccino, Americano, Mochaccino, Green Tea, Red Velvet) digabung jadi satu, dan fotonya ikut berganti saat memilih Hot.
- **Dine in & take away:** nomor meja dari QR (`?meja=12`), jadwal ambil, dan alat makan.
- **Checkout:** QRIS, GoPay, OVO, DANA, ShopeePay, atau bayar di kasir. Harga sesuai buku menu (tanpa tambahan pajak di aplikasi).
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
| `MG_CONFIG` | Nama, alamat, jam buka, WhatsApp, Instagram, peta, pajak, teks beranda, foto suasana |
| `MG_MENU` | Kategori, menu, harga, dan pilihan (ukuran, gula, es) |
| `MG_BANNERS` | Banner di beranda dan kategori yang dibuka |

Kalau Robucca menambahkan pajak/servis di kasir, isi `taxRate` (misalnya `0.10`) dan `taxLabel` (misalnya `"PB1 10%"`); harga dan ringkasan pembayaran akan menyesuaikan.

## Catatan

- Pesanan dan reservasi tersimpan di perangkat masing-masing (localStorage); belum ada backend.
- Status pesanan bergerak otomatis untuk keperluan demo.
- Logo, foto menu, dan konten merek adalah milik Robucca / Rbc Group dan dipakai hanya untuk keperluan demo prototipe ini.
