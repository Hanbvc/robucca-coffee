# Review skema database — Fase 1 PRD

Draft skema ada di [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma) (Prisma 7, PostgreSQL). **Belum ada migrasi dan belum ada CRUD.** Keduanya menunggu skema ini disetujui.

PRD lengkap: `prd-robbucca-v1.md` di folder project (`/mnt/project-files/prd/`).

## Yang sudah diverifikasi

- `prisma validate` dan `prisma format` lolos.
- `prisma db push` ke Postgres 16 sementara: 36 tabel terbentuk.
- Uji constraint dengan SQL langsung:
  - Pembayaran cabang SHT untuk pesanan cabang IJN **ditolak** (FK gabungan `orderId + branchId`).
  - Refund kedua untuk pesanan yang sama **ditolak** (`Refund.orderId` unik).
  - Nomor struk ganda di cabang yang sama **ditolak**; nomor yang sama di cabang lain **diterima**.
  - Mutasi stok untuk bahan yang tidak punya baris stok di cabang itu **ditolak**.
  - Potong stok BoM di cabang yang sama dengan `orderId` **diterima**.
  - Delivery cabang SHT untuk pesanan IJN **ditolak**; delivery kedua untuk pesanan yang sama **ditolak**.
  - Pre-order cabang IJN yang menunjuk reservasi cabang SHT **ditolak**; di cabang yang sama **diterima**.
- `pnpm typecheck` dan `pnpm build` lolos untuk api, pos, dan pwa. Tes POS lama (`npm test`) tetap 46 lulus.

## Gambaran relasi

```mermaid
erDiagram
  Branch ||--o{ UserBranch : ""
  User ||--o{ UserBranch : ""
  Role ||--o{ User : ""
  Branch ||--o{ Device : ""
  Branch ||--o{ ProductBranch : "harga/ketersediaan"
  Product ||--o{ ProductBranch : ""
  Category ||--o{ Product : ""
  Product ||--o{ ProductModifierGroup : ""
  ModifierGroup ||--o{ ProductModifierGroup : ""
  ModifierGroup ||--o{ ModifierOption : ""
  Product ||--o| Recipe : "BoM"
  ModifierOption ||--o| Recipe : "BoM tambahan"
  Recipe ||--o{ RecipeLine : ""
  InventoryItem ||--o{ RecipeLine : ""
  Branch ||--o{ InventoryStock : ""
  InventoryItem ||--o{ InventoryStock : ""
  InventoryStock ||--o{ StockMovement : ""
  Branch ||--o{ Shift : ""
  Shift ||--o{ CashMovement : ""
  Branch ||--o{ Order : ""
  Shift ||--o{ Order : ""
  Customer ||--o{ Order : "Click & Collect"
  Order ||--o{ OrderItem : ""
  OrderItem ||--o{ OrderItemModifier : ""
  Order ||--o{ Payment : ""
  Order ||--o| Refund : ""
  Customer ||--o{ PointTransaction : ""
  Order ||--o{ StockMovement : "potong stok"
  SalesChannel ||--o{ Order : "kanal + markup"
  Promotion ||--o{ Order : ""
  Promotion ||--o{ PromotionBranch : ""
  Branch ||--o{ Reservation : ""
  Reservation ||--o{ Order : "pre-order"
  Order ||--o| Delivery : ""
  CourierService ||--o{ Delivery : ""
  Customer ||--o{ CustomerAddress : ""
  PaymentOption ||--o{ Payment : ""
  Category ||--o{ Banner : ""
```

## Keputusan desain

| Keputusan | Alasan |
| --- | --- |
| Semua tabel transaksi & stok punya `branchId`, dan relasinya memakai **FK gabungan `(id, branchId)`** | Database sendiri menolak data lintas cabang (mis. pembayaran cabang A ke pesanan cabang B). Tidak bergantung pada kode API. |
| Master data (Product, Category, Modifier, InventoryItem, Customer) **global**; per cabang lewat `ProductBranch` (harga khusus, tersedia/tidak) dan `InventoryStock` | PRD: menu terpusat, harga & stok per cabang. Sama dengan model POS lama. |
| ID memakai UUIDv7 yang dibuat di perangkat | POS harus tetap jualan saat offline lalu sinkron (PRD offline-first). |
| Uang dalam `Int` rupiah, persen dalam basis poin (`taxRateBp = 1000` = 10%), kuantitas stok `Decimal(14,3)` | Tidak ada pembulatan float. Gram/ml butuh desimal. |
| Kolom `version` di Order untuk optimistic concurrency | Mengganti "last write wins" berdasar jam perangkat di server lama, yang bisa menghilangkan pembayaran diam-diam. |
| `Refund.orderId` unik | Menutup temuan review kode: refund ganda. |
| `Payment.gatewayReference` unik | Webhook payment gateway yang terkirim dua kali tidak tercatat dua kali. |
| BoM: `Recipe` milik **produk atau opsi modifier**; opsi boleh berisi delta (mis. Large +60 ml susu, Oat menggantikan susu sapi dengan delta negatif) | PRD: penjualan memotong bahan baku sesuai BoM. |
| Snapshot nama, harga, pajak di `OrderItem`/`Order` | Laporan lama tidak berubah saat harga menu diubah. |
| Struk bernomor unik per cabang (`branchId + number`) | Sama dengan POS lama. |

## Pemetaan dari POS lama

| POS lama (`pos/js`, `server/`) | Skema baru |
| --- | --- |
| `branches` (pajak, servis, jam, kertas struk) | `Branch` |
| `staff` + PIN + izin (`perms.js`) | `User`, `Role.permissions`, `UserBranch` |
| perangkat terpasang (pairing) | `Device` |
| `menu.js` kategori, kelompok, stasiun, catatan cepat | `Category` (`group`, `station`, `quickNotes`) |
| item + varian ukuran/suhu/gula/es | `Product` + `ModifierGroup`/`ModifierOption` (+ `showWhenOptionIds` untuk pilihan bersyarat) |
| harga & stok habis per cabang | `ProductBranch` |
| stok bahan | `InventoryItem`, `InventoryStock`, `StockMovement` |
| shift, kas awal, setor/tarik kas | `Shift`, `CashMovement` |
| bill/order, item, void, diskon dengan approver | `Order`, `OrderItem`, `OrderItemModifier` |
| pembayaran tunai/QRIS/kartu | `Payment` |
| refund | `Refund` |
| audit log | `AuditLog` |
| (baru) pelanggan PWA & poin | `Customer`, `PointTransaction` |

## Fitur di luar PRD yang dipertahankan

Atas permintaan Hans (10 Okt 2026), fitur sistem lama yang tidak disebut PRD tetap masuk skema (bagian I di `schema.prisma`):

| Fitur lama | Skema |
| --- | --- |
| Pesanan ojol GoFood/GrabFood/ShopeeFood + markup harga per kanal (POS) | `OrderType.FOOD_PLATFORM`, `SalesChannel`, `Order.channelId`, `channelMarkupBp`, `platformOrderRef` |
| Promo pusat per cabang & periode, sebagian butuh PIN manajer (POS) | `Promotion`, `PromotionBranch`, `Order.promotionId`, `OrderItem.promotionId` |
| Pengaturan: pembulatan, batas diskon kasir, kunci otomatis, cetak otomatis, blokir jual saat stok habis, batas waktu tiket dapur, catatan struk (POS) | `OrganizationSetting` (satu baris), `Branch.receiptFooter` |
| Daftar metode bayar yang bisa diatur, wajib no. referensi untuk kartu/transfer (POS) | `PaymentOption`, `Payment.paymentOptionId` |
| Hitung pecahan saat tutup shift (POS) | `Shift.countedDenominations` |
| Kirim struk via WhatsApp untuk pelanggan tanpa akun (POS) | `Order.customerPhone` |
| Delivery GoSend/GrabExpress: alamat, jarak, ongkir, driver, status (PWA) | `OrderType.DELIVERY`, `FulfillmentStatus.OUT_FOR_DELIVERY`, `Delivery`, `CourierService`, `Order.deliveryFee`, `Branch.acceptsDelivery`/`deliveryMaxKm`/koordinat |
| Alamat tersimpan (PWA) | `CustomerAddress` |
| Reservasi meja + pre-order menu (PWA) | `Reservation`, `Order.reservationId`, `Branch.acceptsReservations`/`maxReservationGuests`/`reservationAreas` |
| Banner beranda (PWA) | `Banner` |

Fitur yang tidak butuh tabel baru: stok menu jadi (pastry) dicatat sebagai bahan `PIECE` dengan resep 1 pcs; tandai habis lewat `ProductBranch.isAvailable`; transfer antarcabang, opname, barang rusak lewat `StockMovement`; tiket dapur, layar antrean, dan menu pelanggan memakai data pesanan & menu yang sudah ada.

## Belum masuk skema (sengaja)
- **CHECK constraint** "Recipe harus milik tepat satu: produk atau opsi" belum bisa ditulis di Prisma. Akan ditulis di migrasi pertama.
- API belum tersambung ke `@robucca/db`. Itu dikerjakan bersama CRUD setelah skema disetujui.

## Pertanyaan untuk disetujui

1. **Peran**: PRD menyebut Super Admin, Branch Manager, Cashier. Skema menambah **KITCHEN** untuk layar dapur. Setuju?
2. **Refund**: hanya **refund penuh**, dan hanya di **cabang yang sama** dengan pesanan. Perlu refund sebagian?
3. **BoM ukuran**: Large disimpan sebagai delta di opsi. Kombinasi yang saling bergantung (Large + Oat = oat lebih banyak) tidak bisa diwakili delta sederhana. Cukup, atau perlu resep per varian?
4. **PIN kasir** 4–6 digit di-hash bcrypt. Tetap mudah ditebak bila hash bocor; perlu batas percobaan di API. Setuju?
5. **Nama kolom**: tetap camelCase bawaan Prisma, atau dipetakan ke snake_case di database?
6. **Delivery & ojol** sudah masuk skema, tetapi integrasi API GoSend/GrabExpress/GoFood belum. Pesanan ojol tetap diinput manual oleh kasir seperti sistem lama. Setuju?
7. **Reservasi**: satu cabang bisa menerima reservasi tanpa batas meja (sama seperti PWA lama). Perlu kuota meja per jam?
