# Robucca POS — sistem kasir multi-cabang

Sistem kasir (point of sale) untuk semua cabang Robucca: **Kasir**, **Dapur/Bar**, **Layar antrean**, dan **Kantor pusat** (laporan & pengaturan). Satu menu pusat berlaku di semua cabang, tiap cabang punya harga khusus, ketersediaan menu, pajak, zona waktu, dan nomor struk sendiri. Kasir tetap bisa berjualan saat internet putus; datanya dikirim ke server pusat begitu online.

> **Status:** siap diuji coba. Belum terhubung ke payment gateway/EDC, API GoFood/GrabFood/ShopeeFood, maupun printer ESC/POS langsung — lihat [Keterbatasan](#keterbatasan--langkah-berikutnya).

## Dua cara memakai

| | **Mode demo** | **Mode server (operasional)** |
|---|---|---|
| Untuk | Mencoba & melatih staf | Dipakai sungguhan di semua cabang |
| Data | Hanya di browser perangkat itu | Satu database pusat untuk semua cabang |
| Isi awal | 3 cabang (Ijen Nirwana + 2 cabang contoh), staf contoh, ±4.500 transaksi **simulasi** 30 hari | Menu dari `js/data.js`, cabang Ijen Nirwana, 1 akun pemilik |
| Cara buka | Buka `/pos/` (mis. GitHub Pages) → **Coba mode demo** | Jalankan server → buka `https://alamat-server/pos/` → **Hubungkan ke server pusat** |

PIN demo: Pemilik **1111** · Manajer **2222** · Kasir **3333 / 3344** · Dapur **4444**. Angka di dasbor mode demo adalah data contoh, bukan penjualan asli.

## Fitur

**Kasir**
- Menu bergambar per kategori + pencarian (tekan `/`), opsi menu (ukuran, gula, es; harga Large/Hot otomatis), catatan cepat.
- Tipe pesanan Dine In (no. meja), Take Away, dan ojol (GoFood/GrabFood/ShopeeFood) dengan **markup harga per kanal**.
- Diskon per item & per pesanan, promo pusat; diskon di atas batas kasir dan promo tertentu butuh **PIN manajer**.
- Pembayaran tunai (saran uang pas/pecahan + kembalian), QRIS, debit, kredit, e-wallet, transfer, dan **bagi pembayaran** (mis. sebagian tunai, sisanya QRIS).
- **Tagihan terbuka** (simpan & kirim ke dapur, bayar belakangan; bisa dibuka di terminal lain di cabang yang sama).
- Struk thermal 58/80 mm (cetak lewat dialog print), kirim struk via WhatsApp, cetak ulang, tiket dapur.
- Riwayat transaksi, **void** (shift berjalan) & **refund** dengan alasan + PIN manajer; tandai menu habis.
- **Shift kas**: kas awal, kas masuk/keluar, tutup shift dengan hitung pecahan, selisih kas wajib dijelaskan, laporan shift.
- Stok menu yang dilacak (pastry/dessert) berkurang otomatis; menu habis tidak bisa dijual (bisa dimatikan).

**Dapur/Bar, antrean & menu pelanggan**
- Tiket per pesanan, filter Bar/Dapur, tandai selesai per item atau per tiket, pesanan tambahan ditandai, item batal dicoret, warna kuning/merah bila menunggu terlalu lama, bunyi tiket baru, kembalikan tiket.
- Layar antrean pelanggan: “Sedang disiapkan” & “Siap diambil”.
- **Menu pelanggan** (`/menu/?cabang=KODE`), hanya untuk dilihat: QR di meja, tablet, atau TV. Isinya diurutkan Minuman → Snack → Makanan Berat → Pastry & Dessert, memakai harga & tanda **Habis** cabang itu (ditandai kasir, atau stok 0), dan diperbarui tiap menit. Datanya dari API publik `GET /api/public/menu?cabang=KODE`, yang tidak memuat data internal (staf, PIN, jumlah stok, pengaturan). Tautan per cabang ada di Kantor › Menu & harga › **Menu pelanggan**.

**Kantor (pemilik semua cabang, manajer cabangnya sendiri)**
- Dasbor: omzet, transaksi, rata-rata, item, diskon, pajak, void — dibanding periode sebelumnya (hari ini dibanding kemarin **sampai jam yang sama**), tren per hari/jam, omzet per cabang, jam ramai, metode bayar, tipe pesanan, kategori, menu terlaris, kondisi tiap cabang hari ini.
- Laporan: ringkasan, per menu, kategori, pembayaran, tipe pesanan, kasir, harian & pajak (DPP), per cabang, void & refund — ekspor CSV (pemisah `;` agar rapi di Excel Indonesia) & cetak.
- Transaksi semua cabang (cari, filter, detail struk, refund dari kantor), rekap shift & selisih kas.
- Menu & harga: satu menu pusat, harga khusus & ketersediaan per cabang, opsi menu, stasiun dapur, pelacakan stok. Kategori selalu tampil per kelompok **Minuman → Snack → Makanan Berat → Pastry & Dessert**; isian “Urutan” mengatur urutan di dalam kelompoknya.
- Stok per cabang: stok masuk, opname, barang rusak, **transfer antarcabang**, riwayat pergerakan.
- Promo (per cabang & periode), cabang (pajak, biaya layanan, zona WIB/WITA/WIT, jam pergantian hari, lebar kertas), karyawan & PIN, perangkat, pengaturan, **log aktivitas** (void, refund, diskon disetujui, shift, kas, stok, perubahan data).

## Cara kerja multi-cabang

```
 Cabang A                       Cabang B                     Kantor pusat
 ┌──────────────┐               ┌──────────────┐             ┌──────────────┐
 │ Kasir T1, T2 │──┐         ┌──│ Kasir T1     │             │ PC / laptop  │
 │ Tablet dapur │  │ HTTPS   │  │ Tablet dapur │             │ (Kantor)     │
 └──────────────┘  ▼         ▼  └──────────────┘             └──────┬───────┘
              ┌───────────────────────────────┐                     │
              │ Server pusat (Node + SQLite)  │◀────────────────────┘
              │ menu & harga · staf · laporan │
              └───────────────────────────────┘
```

- **Offline-first.** Setiap perangkat menyimpan transaksi di IndexedDB dulu, lalu mengirimnya lewat antrean (outbox). Indikator di rail kiri menunjukkan *Online/Offline* dan jumlah data yang menunggu dikirim.
- **Nomor struk tidak pernah bentrok:** `{KODE CABANG}{TERMINAL}-{YYMMDD}-{URUT}`, mis. `IJN1-261006-0042`, dibuat di perangkat tanpa perlu koordinasi (aman saat offline).
- **Data master satu arah** (pusat → perangkat). Perubahan menu/harga/staf dari kantor sampai ke semua perangkat dalam hitungan detik (server-sent events) atau saat sinkron berikutnya.
- **Server memeriksa ulang** setiap transaksi: total dihitung ulang dari baris & tarif pajak; dokumen cabang lain atau total yang dimanipulasi ditolak.
- **Hak akses diperiksa server**: manajer hanya melihat cabangnya, kasir tidak bisa membuka laporan, hanya pemilik yang bisa mengubah harga & pengaturan.
- **Tanggal bisnis per cabang** mengikuti zona waktu cabang (WIB/WITA/WIT), bisa digeser untuk cabang yang buka lewat tengah malam.

## Menjalankan server pusat

Butuh **Node.js 22.13 atau lebih baru** (memakai `node:sqlite` bawaan; diuji di Node 22.22). Tidak ada `npm install` yang diperlukan.

```bash
npm start                    # http://localhost:8787/pos/ (kasir & kantor) dan /menu/ (menu pelanggan), database di ./data/robucca-pos.db
npm run start:demo           # sama, tapi diisi 3 cabang contoh + data simulasi (untuk latihan)
```

Saat pertama kali jalan, konsol menampilkan **PIN pemilik** dan **kode pasang komputer kantor** (berlaku 24 jam). Catat PIN lalu segera ganti di Kantor › Karyawan. Agar PIN pemilik ditentukan sendiri: `OWNER_PIN=246810 npm start`.

| Variabel | Bawaan | Fungsi |
|---|---|---|
| `PORT` | `8787` | Port HTTP |
| `HOST` | `0.0.0.0` | Alamat yang didengarkan |
| `POS_DB` | `./data/robucca-pos.db` | Lokasi database SQLite |
| `OWNER_PIN` | acak 6 digit | PIN pemilik saat database pertama dibuat |
| `CORS_ORIGINS` | kosong | Asal lain yang boleh memanggil API, mis. `https://hanbvc.github.io` bila aplikasi dibuka dari GitHub Pages |
| `TRUST_PROXY` | kosong | Isi `1` bila server di belakang reverse proxy (untuk pembatasan percobaan per IP) |

Perintah tambahan:

```bash
node server/server.js pair --branch IJN --name "Kasir 2" --terminal 2   # kode pasang dari konsol server
node server/server.js pair --hq                                          # kode pasang komputer kantor
node server/server.js reset-pin --staff "Pemilik" --pin 135790           # lupa PIN pemilik
node server/server.js backup --out ./cadangan/pos-2026-10-06.db          # cadangan konsisten (aman saat server jalan)
```

### Pasang di VPS (contoh)

1. VPS Linux kecil sudah cukup untuk puluhan cabang (SQLite + Node). Pilih lokasi data center di Indonesia/Singapura agar latensi rendah.
2. Salin repo, lalu buat layanan systemd `/etc/systemd/system/robucca-pos.service`:

   ```ini
   [Unit]
   Description=Robucca POS
   After=network.target

   [Service]
   WorkingDirectory=/opt/robucca-coffee
   Environment=PORT=8787 POS_DB=/var/lib/robucca-pos/pos.db TRUST_PROXY=1
   ExecStart=/usr/bin/node --no-warnings=ExperimentalWarning server/server.js
   Restart=always
   User=robucca

   [Install]
   WantedBy=multi-user.target
   ```

3. **Wajib HTTPS** (kode PIN & token lewat jaringan). Paling mudah dengan Caddy (`/etc/caddy/Caddyfile`):

   ```
   pos.robucca.id {
     reverse_proxy 127.0.0.1:8787
   }
   ```

4. Cadangan harian, mis. cron `0 23 * * * cd /opt/robucca-coffee && node server/server.js backup --db /var/lib/robucca-pos/pos.db --out /var/backups/robucca/pos-$(date +\%F).db`, lalu salin ke penyimpanan lain (Google Drive/S3).

## Menyiapkan cabang & perangkat

1. **Komputer kantor**: buka `https://alamat-server/pos/` → *Hubungkan ke server pusat* → masukkan kode dari konsol → masuk sebagai pemilik.
2. **Kantor › Cabang**: lengkapi data Ijen Nirwana, tambah cabang lain (kode 2–4 huruf, mis. `SHT`), atur **pajak, biaya layanan, zona waktu, lebar kertas**.
3. **Kantor › Karyawan**: tambah manajer, kasir, dan staf dapur beserta cabang & PIN-nya.
4. **Kantor › Menu & harga**: periksa harga, atur harga khusus/ketersediaan per cabang, aktifkan *Lacak stok* untuk produk jadi.
5. **Kantor › Pengaturan**: pembulatan, batas diskon kasir, markup ojol, metode bayar.
6. **Kantor › Perangkat › Pasangkan perangkat** untuk tiap kasir (terminal 1, 2, …) dan tablet dapur, lalu masukkan kode 6 digit di perangkat itu. Perangkat yang hilang bisa dicabut aksesnya dari halaman yang sama.

Tip perangkat: tablet Android/iPad atau PC dengan Chrome/Edge/Safari terbaru. Tambahkan ke layar utama (*Add to Home Screen*) agar terbuka seperti aplikasi dan tetap bisa dibuka saat offline. Pastikan **jam perangkat otomatis** (dipakai untuk waktu transaksi & urutan sinkron).

### Yang perlu dikonfirmasi sebelum dipakai

- **Pajak:** bawaan setiap cabang adalah **PB1 10% sudah termasuk harga menu** (total yang dibayar = harga buku menu). Ini asumsi — sesuaikan dengan cara Robucca memungut pajak dan perda tiap kota (tarif PBJT makanan-minuman ditetapkan pemerintah daerah). Ubah di Kantor › Cabang; contoh perhitungan tampil langsung di form.
- **Pembulatan:** bawaan ke bawah ke Rp100 (menguntungkan pelanggan).
- **Markup ojol:** bawaan 0%. Isi bila harga di aplikasi ojol berbeda dari harga toko.
- **Cabang 2 & 3** di mode demo hanya contoh; nama & alamatnya fiktif.

## Struk & printer

Struk dicetak lewat dialog print browser, sehingga bekerja dengan printer thermal yang punya driver di sistem operasi (Windows/macOS) atau aplikasi print service di Android (mis. RawBT). Atur lebar kertas per cabang (58/80 mm). Pencetakan otomatis tanpa dialog, laci kas otomatis, dan printer Bluetooth/USB langsung (ESC/POS) **belum didukung**.

## Pengujian

```bash
npm test             # 46 tes: perhitungan pajak/diskon/pembulatan, urutan kelompok & menu pelanggan, laporan, validasi, server (perangkat, sesi, sinkron, hak akses, SSE, menu publik), service worker
npm run test:e2e     # alur di browser: demo (jual, tagihan, dapur, void, tutup shift, dasbor) + server multi-perangkat
                     # butuh: npm i -D playwright && npx playwright install chromium
```

## Struktur kode

```
pos/
  index.html, sw.js, css/pos.css
  js/core/        logika bisnis bersama browser & server (harga, pajak, kelompok & urutan menu, laporan, validasi, PIN, hak akses)
  js/data/        IndexedDB, backend demo/server, sinkronisasi, data contoh
  js/views/       kasir, tagihan, riwayat, shift, dapur, antrean, kantor/*
  js/components/  struk, persetujuan manajer, grafik, numpad
menu/             menu pelanggan (hanya lihat): index.html, menu.js, menu.css
server/
  server.js       API, SSE, CLI      store.js  SQLite      auth.js  token & pembatas      static.js  berkas statis
tests/            node:test + tes browser (tests/e2e/run.js)
```

Menu awal diambil dari `js/data.js` (sama dengan aplikasi pemesanan pelanggan). Setelah POS disiapkan, menu dikelola di Kantor › Menu & harga. Menu pelanggan (`/menu/`) membaca data POS bila dibuka dari server; aplikasi pemesanan masih membaca `js/data.js` sampai keduanya dihubungkan.

## Keamanan

- Token perangkat dan sesi hanya disimpan sebagai hash di server; kode pasang 6 digit sekali pakai dan dibatasi percobaannya.
- PIN di-hash (PBKDF2-SHA256 + salt). Karena PIN hanya 4–6 digit, hash yang tersimpan di perangkat tetap bisa ditebak oleh orang yang menguasai perangkat itu; PIN berfungsi sebagai identitas staf di perangkat yang sudah dipasangkan. Data kantor lintas cabang selalu diverifikasi server dengan batas percobaan. Cabut perangkat yang hilang dari Kantor › Perangkat.
- Server hanya menyajikan folder `pos/`, `assets/`, dan `js/data.js` (database & kode server tidak pernah disajikan), dengan Content-Security-Policy ketat.

## Keterbatasan & langkah berikutnya

- **Belum terintegrasi** dengan payment gateway/QRIS dinamis/EDC (kasir mencatat pembayaran setelah melihat bukti bayar), API GoFood/GrabFood/ShopeeFood (pesanan ojol diinput manual), dan aplikasi pemesanan pelanggan (pesanan dari aplikasi belum masuk ke dapur).
- **Stok** baru untuk produk jadi; resep/bahan baku (HPP per cup) belum ada.
- Belum ada member/poin, reservasi meja di POS, dan refund sebagian (refund selalu penuh).
- Perubahan tagihan terbuka yang sama dari dua terminal sekaligus memakai aturan “versi terakhir menang”.
- SQLite di satu server cocok untuk puluhan cabang; untuk skala jauh lebih besar atau ketersediaan tinggi, pindahkan penyimpanan ke PostgreSQL.
- Bila server pusat mati/tidak terjangkau, kasir tetap berjualan, tetapi tiket dapur di **perangkat lain** dan laporan kantor menunggu koneksi pulih (tiket di perangkat yang sama tetap jalan).
