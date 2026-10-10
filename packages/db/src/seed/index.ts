/* Seed awal "seadanya" dari sistem lama, sambil data final disiapkan.
   - Menu, kategori, opsi, banner, kurir, cabang Ijen Nirwana: dari js/data.js (aplikasi pelanggan lama).
   - Kanal penjualan, metode bayar, pengaturan, peran: dari bawaan POS lama (pos/js/core/seed.js).
   - Bahan baku & resep (BoM) belum ada datanya, jadi belum diisi.
   Aman dijalankan berulang: ID dibuat deterministik dari kunci lama dan memakai upsert.

   Pemakaian (setelah `pnpm --filter @robucca/db build`):
     DATABASE_URL=... node dist/seed/index.js
     SEED_DEMO=1        tambah 3 cabang contoh + staf contoh dengan PIN mudah (khusus dev/demo)
     SEED_OWNER_PIN=…   buat akun pemilik (Super Admin) dengan PIN ini
     SEED_DATA_FILE=…   lokasi js/data.js lain */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { createPrismaClient } from '../index.js';
import {
  ChannelType,
  MenuGroup,
  PaymentMethod,
  RoleCode,
  RoundingMode,
  Station,
  ModifierSelection,
  type PrismaClient,
} from '../generated/prisma/client.js';
import { loadLegacyData, type LegacyCategory, type LegacyOptionGroup } from './legacy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DATA_FILE = process.env.SEED_DATA_FILE ?? path.join(ROOT, 'js', 'data.js');
const DEMO = process.env.SEED_DEMO === '1';

/** UUID deterministik dari kunci teks (format UUID v5/SHA-1), agar seed bisa diulang tanpa duplikat. */
export function sid(key: string): string {
  const h = createHash('sha1').update(`robucca:${key}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const imageUrl = (img: string | null | undefined, fallback: string): string | null =>
  img === null ? null : `assets/img/${img ?? fallback}.jpg`;

const pct = (n: number): number => Math.round(n * 100); // persen → basis poin

// --- Bawaan POS lama -------------------------------------------------------

/** Daftar hak akses (Super Admin '*' = semua): order.sell, order.void.approve, order.refund.approve, discount.approve,
    shift.open/close/manage, cash.manage, kds.view, menu.availability, menu.manage, price.manage, inventory.manage, stock.manage,
    promo.manage, staff.manage, device.manage, branch.manage, settings.manage, report.view, audit.view, reservation.manage.
    Seed memperbarui hak akses peran setiap dijalankan (idempoten). */
const PERMISSIONS: Record<RoleCode, string[]> = {
  SUPER_ADMIN: ['*'],
  BRANCH_MANAGER: [
    'order.sell', 'order.void.approve', 'order.refund.approve', 'discount.approve',
    'shift.manage', 'cash.manage', 'stock.manage', 'menu.availability', 'report.view', 'reservation.manage',
    // Kantor cabang (POS lama: manajer = laporan, stok, karyawan kasir/dapur, perangkat, log cabangnya).
    // Promo khusus cabangnya sendiri. Harga, menu pusat, cabang, & pengaturan hanya pemilik.
    'staff.manage', 'device.manage', 'audit.view', 'promo.manage',
  ],
  CASHIER: ['order.sell', 'shift.open', 'shift.close', 'cash.manage', 'menu.availability', 'reservation.manage'],
  KITCHEN: ['kds.view'],
};
const ROLE_NAMES: Record<RoleCode, string> = {
  SUPER_ADMIN: 'Super Admin',
  BRANCH_MANAGER: 'Manajer Cabang',
  CASHIER: 'Kasir',
  KITCHEN: 'Dapur / Bar',
};

const CHANNELS = [
  { code: 'dinein', name: 'Dine In', type: ChannelType.DINE_IN },
  { code: 'takeaway', name: 'Take Away', type: ChannelType.TAKEAWAY },
  { code: 'gofood', name: 'GoFood', type: ChannelType.FOOD_PLATFORM },
  { code: 'grabfood', name: 'GrabFood', type: ChannelType.FOOD_PLATFORM },
  { code: 'shopeefood', name: 'ShopeeFood', type: ChannelType.FOOD_PLATFORM },
];

const PAYMENT_OPTIONS = [
  { code: 'cash', name: 'Tunai', method: PaymentMethod.CASH, provider: null, ref: false },
  { code: 'qris', name: 'QRIS', method: PaymentMethod.QRIS, provider: null, ref: false },
  { code: 'debit', name: 'Kartu Debit', method: PaymentMethod.DEBIT_CARD, provider: null, ref: true },
  { code: 'credit', name: 'Kartu Kredit', method: PaymentMethod.CREDIT_CARD, provider: null, ref: true },
  { code: 'gopay', name: 'GoPay', method: PaymentMethod.E_WALLET, provider: 'gopay', ref: false },
  { code: 'ovo', name: 'OVO', method: PaymentMethod.E_WALLET, provider: 'ovo', ref: false },
  { code: 'dana', name: 'DANA', method: PaymentMethod.E_WALLET, provider: 'dana', ref: false },
  { code: 'shopeepay', name: 'ShopeePay', method: PaymentMethod.E_WALLET, provider: 'shopeepay', ref: false },
  { code: 'transfer', name: 'Transfer Bank', method: PaymentMethod.BANK_TRANSFER, provider: null, ref: true },
  // Pesanan ojol dibayar lewat aplikasinya (dana masuk lewat transfer platform). Kode = kode kanal;
  // kasir hanya menampilkan metode ini untuk kanal ojol yang sama (POS lama: "dibayar platform").
  { code: 'gofood', name: 'GoFood (dibayar platform)', method: PaymentMethod.BANK_TRANSFER, provider: 'gofood', ref: false },
  { code: 'grabfood', name: 'GrabFood (dibayar platform)', method: PaymentMethod.BANK_TRANSFER, provider: 'grabfood', ref: false },
  { code: 'shopeefood', name: 'ShopeeFood (dibayar platform)', method: PaymentMethod.BANK_TRANSFER, provider: 'shopeefood', ref: false },
];

/** Kelompok kategori; data lama menyimpan pastry & dessert di kelompok "snack". */
function groupOf(c: LegacyCategory): MenuGroup {
  if (c.group === 'snack' && (c.id === 'pastry' || c.id === 'dessert')) return MenuGroup.PASTRY;
  switch (c.group) {
    case 'drinks': return MenuGroup.DRINKS;
    case 'food': return MenuGroup.FOOD;
    case 'pastry': return MenuGroup.PASTRY;
    default: return MenuGroup.SNACK;
  }
}

/** Minuman, pastry & dessert → Bar; snack & makanan → Dapur (sama dengan POS lama). */
const stationOf = (g: MenuGroup): Station => (g === MenuGroup.DRINKS || g === MenuGroup.PASTRY ? Station.BAR : Station.KITCHEN);

/** Kunci grup opsi: grup lama yang isinya identik dipakai bersama; yang berbeda (mis. harga Hot atau
    foto Hot per menu) menjadi grup sendiri. */
function groupKey(g: LegacyOptionGroup): string {
  const { showIf: _ignored, ...rest } = g;
  return createHash('sha1').update(JSON.stringify(rest)).digest('hex').slice(0, 16);
}

// --- Seed ------------------------------------------------------------------

async function seed(db: PrismaClient): Promise<void> {
  const { MENU, CONFIG, BANNERS } = loadLegacyData(DATA_FILE);

  await db.organizationSetting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      orgName: CONFIG.storeName ?? 'Robucca',
      tagline: CONFIG.tagline ?? null,
      instagram: CONFIG.handle ?? null,
      roundingUnit: 100,
      roundingMode: RoundingMode.DOWN,
      maxCashierDiscountBp: pct(10),
      receiptFooter: `Terima kasih!${CONFIG.handle ? ` Follow ${CONFIG.handle}` : ''}`,
    },
  });

  for (const code of Object.values(RoleCode)) {
    await db.role.upsert({
      where: { code },
      update: { permissions: PERMISSIONS[code] },
      create: { id: sid(`role:${code}`), code, name: ROLE_NAMES[code], permissions: PERMISSIONS[code] },
    });
  }

  // Cabang: Ijen Nirwana dari js/data.js. Pajak mengikuti bawaan POS lama (PB1 10% sudah termasuk harga).
  const ijn = {
    code: 'IJN',
    name: CONFIG.branch ?? 'Ijen Nirwana',
    address: CONFIG.address ?? null,
    phone: CONFIG.phoneDisplay ?? null,
    openTime: CONFIG.open ?? '08:00',
    closeTime: CONFIG.close ?? '21:00',
    latitude: CONFIG.lat ?? null,
    longitude: CONFIG.lng ?? null,
    acceptsDelivery: true,
    deliveryMaxKm: CONFIG.delivery?.maxKm ?? null,
    acceptsReservations: true,
    maxReservationGuests: CONFIG.maxGuests ?? 30,
    reservationAreas: (CONFIG.areas ?? []).map((a) => a.v),
  };
  const branches = [ijn];
  if (DEMO) {
    for (const n of [2, 3, 4]) {
      branches.push({
        ...ijn,
        code: `CB${n}`,
        name: `Cabang ${n} (contoh)`,
        address: 'Alamat contoh, ubah di dasbor',
        phone: null,
        latitude: null,
        longitude: null,
        acceptsDelivery: false,
      });
    }
  }
  for (const b of branches) {
    await db.branch.upsert({ where: { code: b.code }, update: {}, create: { id: sid(`branch:${b.code}`), ...b } });
  }

  for (const [i, c] of CHANNELS.entries()) {
    await db.salesChannel.upsert({
      where: { code: c.code },
      update: {},
      create: { id: sid(`channel:${c.code}`), ...c, sortOrder: i + 1 },
    });
  }
  for (const [i, p] of PAYMENT_OPTIONS.entries()) {
    await db.paymentOption.upsert({
      where: { code: p.code },
      update: {},
      create: {
        id: sid(`pay:${p.code}`),
        code: p.code,
        name: p.name,
        method: p.method,
        provider: p.provider,
        requiresReference: p.ref,
        sortOrder: i + 1,
      },
    });
  }
  for (const [i, c] of (CONFIG.delivery?.couriers ?? []).entries()) {
    await db.courierService.upsert({
      where: { code: c.id },
      update: {},
      create: {
        id: sid(`courier:${c.id}`),
        code: c.id,
        name: c.name,
        provider: c.by,
        baseFee: c.base,
        perKmFee: c.perKm,
        minFee: c.min,
        sortOrder: i + 1,
      },
    });
  }

  // Menu. Harga & isi diperbarui setiap seed agar mengikuti js/data.js selama data final belum ada.
  let products = 0;
  const groups = new Set<string>();
  for (const [ci, c] of MENU.entries()) {
    const group = groupOf(c);
    const categoryId = sid(`category:${c.id}`);
    const cat = { name: c.name, group, station: stationOf(group), quickNotes: c.notes ?? [], sortOrder: ci + 1 };
    await db.category.upsert({ where: { id: categoryId }, update: cat, create: { id: categoryId, ...cat } });

    for (const [ii, it] of c.items.entries()) {
      const productId = sid(`product:${it.id}`);
      const prod = {
        categoryId,
        name: it.name,
        basePrice: it.price,
        imageUrl: imageUrl(it.img, it.id),
        isSignature: !!it.sig,
        sortOrder: ii + 1,
      };
      await db.product.upsert({ where: { slug: it.id }, update: prod, create: { id: productId, slug: it.id, ...prod } });
      products++;

      // Grup opsi: buat sekali per isi yang sama, lalu tautkan ke produk.
      const optionIds = new Map<string, Map<string, string>>(); // id grup lama → nama opsi → id opsi
      for (const g of it.opts ?? []) {
        const groupId = sid(`modgroup:${groupKey(g)}`);
        const names = new Map<string, string>();
        if (!groups.has(groupId)) {
          groups.add(groupId);
          const data = {
            name: g.name,
            selection: g.type === 'multi' ? ModifierSelection.MULTIPLE : ModifierSelection.SINGLE,
            isRequired: !!g.required,
          };
          await db.modifierGroup.upsert({ where: { id: groupId }, update: data, create: { id: groupId, ...data } });
        }
        const def = g.type === 'multi' ? null : (g.def ?? g.choices[0]?.n);
        for (const [oi, ch] of g.choices.entries()) {
          const optionId = sid(`modoption:${groupId}:${ch.n}`);
          names.set(ch.n, optionId);
          const opt = {
            groupId,
            name: ch.n,
            priceDelta: ch.p ?? 0,
            isDefault: ch.n === def,
            imageUrl: ch.img ? imageUrl(ch.img, ch.img) : null,
            sortOrder: oi + 1,
          };
          await db.modifierOption.upsert({ where: { id: optionId }, update: opt, create: { id: optionId, ...opt } });
        }
        optionIds.set(g.id, names);
      }
      for (const [gi, g] of (it.opts ?? []).entries()) {
        const groupId = sid(`modgroup:${groupKey(g)}`);
        const showWhenOptionIds = Object.entries(g.showIf ?? {}).flatMap(([other, values]) =>
          values.map((v) => optionIds.get(other)?.get(v)).filter((x): x is string => !!x),
        );
        await db.productModifierGroup.upsert({
          where: { productId_groupId: { productId, groupId } },
          update: { sortOrder: gi + 1, showWhenOptionIds },
          create: { productId, groupId, sortOrder: gi + 1, showWhenOptionIds },
        });
      }
    }
  }

  for (const [i, b] of BANNERS.entries()) {
    const id = sid(`banner:${b.img}`);
    const data = {
      imageUrl: imageUrl(b.img, b.img)!,
      label: b.label,
      categoryId: b.cat && MENU.some((c) => c.id === b.cat) ? sid(`category:${b.cat}`) : null,
      objectPosition: b.pos ?? 'center',
      sortOrder: i + 1,
    };
    await db.banner.upsert({ where: { id }, update: data, create: { id, ...data } });
  }

  // Staf. Produksi: hanya pemilik bila SEED_OWNER_PIN diisi. Demo: staf contoh POS lama.
  const people: [key: string, name: string, role: RoleCode, branchCodes: string[], pin: string][] = [];
  if (process.env.SEED_OWNER_PIN) people.push(['owner', 'Pemilik', RoleCode.SUPER_ADMIN, [], process.env.SEED_OWNER_PIN]);
  if (DEMO) {
    people.push(
      ['demo-owner', 'Pemilik (demo)', RoleCode.SUPER_ADMIN, [], '1111'],
      ['demo-ijn-m', 'Dewi', RoleCode.BRANCH_MANAGER, ['IJN'], '2222'],
      ['demo-ijn-k1', 'Sari', RoleCode.CASHIER, ['IJN'], '3333'],
      ['demo-ijn-d', 'Dapur IJN', RoleCode.KITCHEN, ['IJN'], '4444'],
    );
  }
  for (const [key, name, role, branchCodes, pin] of people) {
    if (!/^\d{4,6}$/.test(pin)) throw new Error(`PIN ${key} harus 4–6 digit`);
    const id = sid(`user:${key}`);
    await db.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name,
        pinHash: await bcrypt.hash(pin, 10),
        role: { connect: { code: role } },
        branches: { create: branchCodes.map((code) => ({ branchId: sid(`branch:${code}`) })) },
      },
    });
  }

  console.log(
    `Seed selesai: ${branches.length} cabang, ${MENU.length} kategori, ${products} menu, ${groups.size} grup opsi, ` +
      `${BANNERS.length} banner, ${people.length} staf${DEMO ? ' (mode demo)' : ''}.`,
  );
}

const db = createPrismaClient();
seed(db)
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
