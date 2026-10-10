# API Kantor (`/office/*`)

Back-office untuk pemilik dan manajer cabang: dasbor, transaksi, laporan, shift, menu & harga, resep, stok, promo,
karyawan, perangkat, cabang, pengaturan, dan log aktivitas. Ini porting modul "Kantor" POS lama (`js/`), tapi datanya
dari server pusat, bukan dari perangkat. UI-nya ada di `apps/pos/src/office` dan hanya jalan saat online.

Kode: `apps/api/src/modules/office/` (controller `office.controller.ts`, DTO `office.dto.ts`, layanan `*.service.ts`).
Tes: `apps/api/test/office.test.mjs` (DB turunan `<TEST_DATABASE_URL>_office`, dibuat otomatis).

## Konvensi

| Hal | Aturan |
|---|---|
| Autentikasi | Header `X-Session` dari `POST /pos/login` (perangkat terpasang) atau `POST /auth/login` (email + password). Semua rute memakai `StaffGuard`. |
| Hak akses | `@RequirePermission(perm)` atau `needAny([...])` per rute. Peran `SUPER_ADMIN` punya `'*'`. Tanpa hak → `403`. |
| Cakupan cabang | Super Admin: semua cabang. Staf lain: hanya cabang di `UserBranch` (`canBranch`). Data cabang lain → `403`/`404`, dan filter `branchId` otomatis dipersempit. |
| Uang | Rupiah bulat (`Int`). |
| Persen | Basis poin: `1000` = 10%. Contoh: `taxRateBp`, `serviceRateBp`, `markupBp`, nilai promo `PERCENT`. |
| Jumlah bahan | Angka desimal (maks. 3 desimal) dalam satuan bahan (`GRAM`, `MILLILITER`, `PIECE`). |
| Validasi | Semua body/query lewat DTO `class-validator` (`whitelist`, `forbidNonWhitelisted`). Pesan galat berbahasa Indonesia. |
| Periode | `preset` (`today`, `yesterday`, `7d`, `30d`, `month`, `lastmonth`) **atau** `from` + `to` (`YYYY-MM-DD`, maks. 400 hari). "Hari ini" mengikuti zona waktu & jam mulai hari bisnis cabang (bila satu cabang dipilih), selain itu WIB. |
| Filter cabang | `branchId` (boleh diulang untuk beberapa cabang). Kosong = semua cabang yang boleh diakses. |
| Halaman | `limit` (bawaan per rute, maks. 5000) dan `offset`. |
| CSV | `format=csv` → `text/csv`, BOM UTF-8, pemisah `;` (rapi di Excel Indonesia), nama berkas lewat `Content-Disposition`. |
| Log aktivitas | Setiap perubahan ditulis lewat `AuditService` (tabel `AuditLog`) atas nama staf yang login. |
| Event | Perubahan yang memengaruhi perangkat memancarkan event SSE `master` (`EventsService`), yaitu `{ reason, at }` per cabang, atau `branchId: null` untuk semua cabang. POS lalu menarik ulang `GET /pos/master`. Alasan: `menu`, `recipe`, `stock`, `promo`, `staff`, `branch`, `settings`. |
| Klien | Total dan harga tidak pernah dipercaya dari klien. IP tidak diambil dari `X-Forwarded-For`. |

## Peran & hak akses (seed, idempoten)

`packages/db/src/seed` melakukan `upsert` peran dengan daftar hak di bawah. Seed ulang selalu menyetel ulang daftar hak itu.

| Peran | Hak |
|---|---|
| `SUPER_ADMIN` (Pemilik) | `*` |
| `BRANCH_MANAGER` (Manajer Cabang) | `order.sell`, `order.void.approve`, `order.refund.approve`, `discount.approve`, `shift.manage`, `cash.manage`, `stock.manage`, `menu.availability`, `report.view`, `reservation.manage`, `staff.manage`, `device.manage`, `audit.view`, `promo.manage` |
| `CASHIER` (Kasir) | `order.sell`, `shift.open`, `shift.close`, `cash.manage`, `menu.availability`, `reservation.manage` |
| `KITCHEN` (Dapur / Bar) | `kds.view` |

Hak khusus kantor:
- `menu.manage`, `price.manage`, `inventory.manage`, `branch.manage` dan `settings.manage` hanya dimiliki pemilik.
- Manajer mengelola karyawan, perangkat, promo, stok, dan log **hanya untuk cabangnya**:
  - Manajer hanya bisa memberi peran Kasir dan Dapur.
  - Promo semua cabang hanya bisa dibuat pemilik.

## Rute

### Sesi
| Metode | Jalur | Hak | Keterangan |
|---|---|---|---|
| GET | `/office/me` | (login) | `{ staff:{id,name,role,permissions}, allBranches, branches:[{id,code,name,timezone,dayStartMinute,isActive}], device }` |

### Dasbor & laporan (`report.view`)
| Metode | Jalur | Keterangan |
|---|---|---|
| GET | `/office/dashboard` | Lihat rincian di bawah tabel. |
| GET | `/office/branch-status` | Status tiap cabang: online/offline perangkat, shift terbuka, omzet hari ini. |
| GET | `/office/reports` | `Report` lengkap untuk periode. Dengan `view` + `format=csv`, hanya bagian itu sebagai CSV. Nilai `view`: `summary`, `items`, `categories`, `payments`, `channels`, `cashiers`, `days`, `hours`, `branches`, `discounts`, `voids`. |
| GET | `/office/transactions` | `{ total, summary, rows:TxRow[] }`. Filter: `status`, `q` (nomor/pelanggan), `type`, `source`, `channel`, `payment`, `cashierId`, `shiftId`. Mendukung CSV. |
| GET | `/office/transactions/:id` | Detail: item + opsi, total, pembayaran, void/refund, jejak audit. |
| GET | `/office/shifts` | `{ totals, rows }`. Filter: `status`, `deviceId`. Mendukung CSV. |
| GET | `/office/shifts/:id` | Rinci per metode bayar, kas seharusnya vs. dihitung (`difference`), pecahan uang, kas masuk/keluar (`cashMovements`), dan pesanan. |

Isi `GET /office/dashboard`:
- `range`, `prevRange` dan `compareLabel`.
- `current: Report` dan `previous: {kpi, days, hours}`.
- `comparison: {previous, deltaPct}`, `dailyAverage` dan `topItems`.
- `branchStatus[]`, `today` dan `live`.

Omzet dihitung dari pesanan `PAID` dan `REFUNDED` per tanggal bisnis, dikurangi refund. Void tidak dihitung, tetapi ikut dilaporkan.

### Menu, harga, opsi
| Metode | Jalur | Hak | Keterangan |
|---|---|---|---|
| GET | `/office/menu?branchId=` | salah satu dari `menu.manage`, `menu.availability`, `price.manage`, `report.view` | `{ branches, categories, products, modifierGroups }`. Setiap produk membawa `branchSettings`, tautan grup opsi dan jumlah baris resep. |
| POST/PATCH | `/office/categories[/:id]` | `menu.manage` | |
| POST/PATCH | `/office/products[/:id]` | `menu.manage` (+ `price.manage` bila `basePrice` berubah) | Event `master` untuk semua cabang. |
| PUT | `/office/products/:id/modifier-groups` | `menu.manage` | Urutan + syarat tampil grup. |
| PUT | `/office/products/:id/branches/:branchId` | `menu.availability` untuk `isAvailable`; `price.manage` untuk `priceOverride` (`null` = harga pusat) | Event `master` hanya untuk cabang itu. Audit: `menu.price.branch`. |
| POST/PATCH | `/office/modifier-groups[/:id]`, `/office/modifier-groups/:id/options`, `/office/modifier-options/:id` | `menu.manage` | Grup opsi dipakai bersama oleh banyak menu. |

### Resep (BoM)
| Metode | Jalur | Hak |
|---|---|---|
| GET | `/office/recipes` | salah satu dari `menu.manage`, `stock.manage`, `inventory.manage` |
| GET/PUT/DELETE | `/office/products/:id/recipe` | GET: sama seperti di atas. PUT/DELETE: `menu.manage` |
| GET/PUT/DELETE | `/office/modifier-options/:id/recipe` | sama seperti di atas. Untuk resep opsi, jumlah negatif berarti bahan dikurangi (mis. "tanpa susu"). |

### Bahan baku & stok
| Metode | Jalur | Hak | Keterangan |
|---|---|---|---|
| GET | `/office/inventory-items` | salah satu dari `stock.manage`, `inventory.manage`, `menu.manage`, `report.view` | |
| POST/PATCH | `/office/inventory-items[/:id]` | `inventory.manage` | Satuan terkunci setelah ada pergerakan stok. |
| GET | `/office/stock?branchId=` | `stock.manage` / `report.view` | `{ rows: [{inventoryItemId, sku, name, unit, quantity, reorderLevel, status: OK/LOW/OUT/UNTRACKED}] }` |
| GET | `/office/stock/low` | idem | Stok menipis/habis di cabang yang boleh diakses. |
| GET | `/office/stock/movements` | idem | `{ rows }`, halaman + periode. |
| PUT | `/office/stock/:branchId/:itemId/reorder-level` | `stock.manage` | Batas menipis. |
| POST | `/office/stock/in` | `stock.manage` | `{branchId, type: PURCHASE/WASTE, lines:[{inventoryItemId, quantity}], note}`. Audit: `stock.receive` / `stock.waste`. |
| POST | `/office/stock/opname` | `stock.manage` | `{branchId, lines:[{inventoryItemId, counted}]}`. Membuat `ADJUSTMENT` sebesar selisihnya. Audit: `stock.adjust`. |
| POST | `/office/stock/transfer` | `stock.manage` (kedua cabang harus dalam akses) | `TRANSFER_OUT` + `TRANSFER_IN` dengan `transferId` yang sama. |

### Promo (`promo.manage`)
`GET /office/promos`, `POST /office/promos`, `PATCH /office/promos/:id`, `DELETE /office/promos/:id`.
- Body: `{ name, type: PERCENT|AMOUNT, value, allBranches, branchIds[], validFrom, validUntil, requiresApproval, isActive }`.
- `value` untuk `PERCENT` dalam bp, maks. 10000.
- Promo yang sudah dipakai pesanan dinonaktifkan, bukan dihapus (`promo.deactivate`).

### Karyawan (`staff.manage`)
| Metode | Jalur | Keterangan |
|---|---|---|
| GET | `/office/roles` | Peran + `assignable` (boleh diberikan oleh staf yang login). |
| GET | `/office/staff?includeInactive=` | Daftar staf di cakupan. Setiap baris memuat `hasPin`, `hasPassword`, `branches` dan `editable`. |
| POST | `/office/staff` | `{ name, role, branchIds, pin, email?, password?, isActive }`. PIN 4–6 digit dan unik per cabang (`409` bila bentrok). |
| PATCH | `/office/staff/:id` | Ubah nama, peran, cabang, aktif, atau email (email hanya oleh pemilik). Minimal satu Super Admin aktif harus tersisa. |
| PUT | `/office/staff/:id/pin` | Audit: `staff.pin`. |
| PUT | `/office/staff/:id/password` | Password minimal 8 karakter dan butuh email. |
| DELETE | `/office/staff/:id` | Menonaktifkan. Tidak bisa untuk akun sendiri. |

### Perangkat (`device.manage`)
- `GET /office/devices` mengembalikan status `ONLINE`/`OFFLINE`/`PENDING`/`REVOKED`.
- `POST /office/devices` dengan body `{branchId|null, name, terminalNo}` mengembalikan kode pasang 6 digit.
- `POST /office/devices/:id/pairing-code` membuat kode baru.
- `DELETE /office/devices/:id` mencabut akses.
- Perangkat kantor pusat (`branchId: null`) hanya bisa dikelola pemilik.
- Perangkat yang sedang dipakai tidak bisa dicabut.

### Cabang
- `GET /office/branches` butuh salah satu dari `branch.manage`, `settings.manage`, `report.view`.
- `POST /office/branches` hanya untuk Super Admin.
- `PATCH /office/branches/:id` butuh `branch.manage`. Pajak, servis, zona waktu, jam mulai hari bisnis, dan toggle PWA/delivery/reservasi bisa diubah.
- Kode cabang terkunci setelah ada transaksi, karena dipakai di nomor struk.

### Pengaturan (`settings.manage`, baca juga `report.view`)
Rute:
- `GET /office/settings` mengembalikan `{ settings, channels, paymentOptions, couriers, banners }`.
- `PATCH /office/settings`.
- `POST|PATCH /office/channels[/:id]`: `markupBp` hanya untuk kanal ojol.
- `POST|PATCH /office/payment-options[/:id]`: tunai tidak bisa dinonaktifkan.
- `POST|PATCH /office/couriers[/:id]`.
- `POST|PATCH|DELETE /office/banners[/:id]`.

### Log aktivitas (`audit.view`)
- `GET /office/audit` dengan filter `action` (awalan `stock.` boleh), `entity`, periode, `branchId` dan `central=true`, lalu mengembalikan `{ total, limit, offset, range, rows:[{action, entity, entityId, detail, createdAt, branchId, branchName, actorName}] }`.
- `central=true` menampilkan perubahan pusat (tanpa cabang) dan hanya untuk Super Admin.
- Mendukung CSV (`limit` hingga 5000).
- `GET /office/audit/actions` mengembalikan `[{action, count}]` untuk isi filter.

Aksi yang dicatat:
- **Transaksi & shift:** `order.void`, `order.refund`, `line.void`, `discount.approve`, `shift.open`, `shift.close`, `cash.in`, `cash.out`, `approval.token`.
- **Stok & bahan:** `stock.receive`, `stock.waste`, `stock.adjust`, `stock.transfer`, `stock.reorder_level`, `inventory.create|update`.
- **Resep & menu:** `recipe.update|delete`, `menu.*`.
- **Promo & karyawan:** `promo.create|update|delete|deactivate`, `staff.create|update|deactivate|pin|password`.
- **Perangkat, cabang & pengaturan:** `device.create|pair|repair|revoke`, `branch.create|update`, `settings.update`, `channel.*`, `payment_option.*`, `courier.*`, `banner.*`.

## Perubahan keamanan: PIN penyetuju tidak lagi di perangkat

Sebelumnya `GET /pos/master` mengirim hash bcrypt PIN **semua** staf ke perangkat agar login dan persetujuan bisa dilakukan offline. Masalahnya, PIN 4–6 digit mudah ditebak offline dari hash itu. Kasir bisa menebak PIN manajer lalu menyetujui void, refund, atau diskonnya sendiri.

Sekarang:
1. **Hash PIN tidak dikirim** untuk staf yang punya salah satu hak penyetuju: `*`, `order.void.approve`, `order.refund.approve`, `discount.approve` (`APPROVER_PERMS` di `pos.service.ts`). Di `/pos/master` mereka muncul dengan `pinHash: null, onlineOnly: true`.
2. **Manajer dan pemilik hanya bisa login di POS saat online**, lewat `POST /pos/login`. Saat offline, layar login menandai mereka "butuh koneksi" dan menjelaskan alasannya. Staf kasir dan dapur tetap bisa login offline.
3. **Persetujuan manajer offline dihapus dari UI.** Tindakan yang butuh persetujuan (void, refund, diskon di atas batas, promo berpersetujuan) menampilkan "Butuh koneksi untuk persetujuan manajer" saat offline. Persetujuan selalu lewat `POST /pos/approve`: PIN diperiksa server, lalu server mengembalikan token bertanda tangan.
4. **`POST /pos/sync` menolak persetujuan offline.** Dokumen yang hanya membawa ID penyetuju tanpa token (`approval.offline` / `discountApprovedById`) dan penyetujunya bukan kasir itu sendiri ditolak dengan pesan "Persetujuan manajer offline tidak diterima…". Lihat tes di `test/pos.test.mjs`.
5. **Aturan token persetujuan:**
   - Token berlaku 5 menit, tetapi boleh terkirim hingga 24 jam kemudian (perangkat sempat offline setelah disetujui).
   - Token terikat ke perangkat dan hak yang disetujui, serta hanya untuk **satu pesanan** (dicatat sebagai `approval.token`).
   - Token membawa `jti` acak, sehingga dua persetujuan dalam detik yang sama tetap berbeda.

## Shift per terminal

- `GET /pos/shift/open` (perangkat) mengembalikan shift `OPEN` terakhir untuk terminal ini beserta kas masuk/keluarnya, atau `{shift:null}`. POS memanggilnya setelah dipasang ulang dan sebelum membuka shift baru, lalu melanjutkan shift server itu. Toast: "Melanjutkan shift terbuka dari server".
- `/pos/sync` menolak shift `OPEN` kedua untuk terminal yang sama: "Terminal N masih punya shift terbuka (dibuka X). Lanjutkan shift itu atau tutup dulu."
- Batasan: tidak ada constraint unik di DB. Dua sinkron yang benar-benar bersamaan masih bisa lolos (lihat "Celah yang diketahui").

## Celah yang diketahui

- Seed ulang menimpa harga menu pusat dan daftar hak peran ke nilai bawaan.
- Duplikasi shift `OPEN` dicegah di aplikasi, bukan dengan indeks unik parsial di DB.
- `/pos/sync` masih memercayai `cashierId` dari perangkat. Perangkat yang sah bisa mengaku sebagai kasir lain di cabangnya. Persetujuan untuk diri sendiri lewat cara ini hanya mungkin bila kasir yang diaku memang berhak menyetujui.
- Pembatalan item di keranjang (`line.void`, dicatat perangkat lewat log) belum diperiksa persetujuannya oleh server.
- Kantor hanya online. Di mode demo, halaman Kantor menampilkan penjelasan.
- Refund dari Kantor hanya untuk pesanan di cabang perangkat yang dipakai (refund lewat sinkron perangkat).
