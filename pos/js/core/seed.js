/* =========================================================
   Data awal POS. Menu, harga, foto, dan opsi diambil dari js/data.js
   (sumber yang sama dengan aplikasi pemesanan pelanggan), lalu dikelola di
   Kantor › Menu. Cabang & staf contoh hanya dibuat untuk mode demo.
   ========================================================= */
import { hashPin } from './pin.js';

export const MASTER_COLLS = ['settings', 'branches', 'categories', 'items', 'itemBranch', 'channels', 'payMethods', 'discounts', 'staff'];

const COLORS = ['#01512C', '#9A6A3B', '#2F6E8F', '#8A3B5C', '#5B6B2E', '#B5651D', '#4E4A8C', '#2E7D6B'];
export const staffColor = (i) => COLORS[i % COLORS.length];

/** Stasiun dapur bawaan: minuman, pastry & dessert → Bar; makanan & snack → Dapur */
const stationOf = (cat) => (cat.group === 'drinks' || ['pastry', 'dessert'].includes(cat.id) ? 'bar' : 'kitchen');

export function defaultSettings(CONFIG = {}) {
  return {
    id: 'org',
    orgName: CONFIG.storeName || 'Robucca',
    company: CONFIG.tagline || '',
    instagram: CONFIG.handle || '',
    roundUnit: 100,
    roundMode: 'down',
    maxDiscPct: 10,             // diskon manual kasir di atas ini butuh PIN manajer
    autoLockMin: 0,             // 0 = tidak kunci otomatis
    autoPrint: false,
    blockNoStock: true,         // menu yang stoknya dilacak tidak bisa dijual saat stok 0
    kdsWarnMin: 8,
    kdsLateMin: 15,
    receiptFooter: `Terima kasih!${CONFIG.handle ? ' Follow ' + CONFIG.handle : ''}`,
  };
}

export function branchFromConfig(CONFIG = {}) {
  return {
    id: 'br-ijn', code: 'IJN', name: CONFIG.branch || 'Ijen Nirwana',
    address: CONFIG.address || '', phone: CONFIG.phoneDisplay || '',
    tz: 'Asia/Jakarta', dayStart: 0,
    taxPct: 10, taxIncl: true, taxService: true, servicePct: 0, taxLabel: 'PB1',
    open: CONFIG.open || '08:00', close: CONFIG.close || '21:00',
    paper: 80, receiptFooter: '', active: true,
  };
}

export const DEFAULT_CHANNELS = [
  { id: 'dinein', name: 'Dine In', type: 'dinein', markupPct: 0, active: true, sort: 1 },
  { id: 'takeaway', name: 'Take Away', type: 'takeaway', markupPct: 0, active: true, sort: 2 },
  { id: 'gofood', name: 'GoFood', type: 'platform', markupPct: 0, active: true, sort: 3 },
  { id: 'grabfood', name: 'GrabFood', type: 'platform', markupPct: 0, active: true, sort: 4 },
  { id: 'shopeefood', name: 'ShopeeFood', type: 'platform', markupPct: 0, active: true, sort: 5 },
];

export const DEFAULT_PAYS = [
  { id: 'cash', name: 'Tunai', type: 'cash', ref: false, active: true, sort: 1 },
  { id: 'qris', name: 'QRIS', type: 'noncash', ref: false, active: true, sort: 2 },
  { id: 'debit', name: 'Kartu Debit', type: 'noncash', ref: true, active: true, sort: 3 },
  { id: 'credit', name: 'Kartu Kredit', type: 'noncash', ref: true, active: true, sort: 4 },
  { id: 'gopay', name: 'GoPay', type: 'noncash', ref: false, active: true, sort: 5 },
  { id: 'ovo', name: 'OVO', type: 'noncash', ref: false, active: true, sort: 6 },
  { id: 'dana', name: 'DANA', type: 'noncash', ref: false, active: true, sort: 7 },
  { id: 'shopeepay', name: 'ShopeePay', type: 'noncash', ref: false, active: true, sort: 8 },
  { id: 'transfer', name: 'Transfer Bank', type: 'noncash', ref: true, active: true, sort: 9 },
];

/** Kategori & menu dari js/data.js (MG_MENU, MG_GROUPS) */
export function menuFromData(MENU = [], { demo = false } = {}) {
  const categories = []; const items = [];
  MENU.forEach((c, ci) => {
    categories.push({ id: c.id, name: c.name, group: c.group || '', station: stationOf(c), notes: c.notes || [], sort: ci + 1, active: true });
    c.items.forEach((it, ii) => {
      items.push({
        id: it.id, catId: c.id, name: it.name, price: it.price, img: it.img === undefined ? it.id : it.img,
        opts: it.opts ? JSON.parse(JSON.stringify(it.opts)) : [], sig: !!it.sig, active: true, sort: ii + 1,
        track: demo && ['pastry', 'dessert'].includes(c.id), low: 5,
      });
    });
  });
  return { categories, items };
}

/**
 * Data master lengkap.
 * demo: tiga cabang (satu nyata dari js/data.js + dua contoh), staf contoh dengan PIN mudah.
 * produksi: satu cabang dari js/data.js + satu akun pemilik dengan `ownerPin`.
 */
export async function seedMaster({ MENU, CONFIG, demo = false, ownerPin = '' } = {}) {
  const settings = defaultSettings(CONFIG);
  const main = branchFromConfig(CONFIG);
  const branches = [main];
  if (demo) {
    branches.push(
      { ...main, id: 'br-cb2', code: 'CB2', name: 'Cabang 2 (contoh)', address: 'Alamat contoh — ubah di Kantor › Cabang', phone: '' },
      { ...main, id: 'br-cb3', code: 'CB3', name: 'Cabang 3 (contoh)', address: 'Alamat contoh — ubah di Kantor › Cabang', phone: '' },
    );
  }
  const { categories, items } = menuFromData(MENU, { demo });
  const itemBranch = [];
  const discounts = [];
  const staff = [];
  if (demo) {
    // Contoh pengaturan per cabang (hanya di cabang contoh)
    if (items.find((i) => i.id === 'truffle-fries')) itemBranch.push({ id: 'br-cb3:truffle-fries', branchId: 'br-cb3', itemId: 'truffle-fries', available: false });
    if (items.find((i) => i.id === 'kopi-susu-essentials')) itemBranch.push({ id: 'br-cb2:kopi-susu-essentials', branchId: 'br-cb2', itemId: 'kopi-susu-essentials', price: 25000 });
    discounts.push(
      { id: 'disc-member', name: 'Member 10%', type: 'pct', value: 10, branchIds: ['*'], approval: false, active: true },
      { id: 'disc-staff', name: 'Karyawan 20%', type: 'pct', value: 20, branchIds: ['*'], approval: true, active: true },
      { id: 'disc-voucher', name: 'Voucher Rp10.000', type: 'amt', value: 10000, branchIds: ['*'], approval: false, active: true },
    );
    const people = [
      ['st-owner', 'Pemilik (demo)', 'owner', ['*'], '1111'],
      ['st-ijn-m', 'Dewi', 'manager', ['br-ijn'], '2222'],
      ['st-ijn-k1', 'Sari', 'cashier', ['br-ijn'], '3333'],
      ['st-ijn-k2', 'Budi', 'cashier', ['br-ijn'], '3344'],
      ['st-ijn-d', 'Agus', 'kitchen', ['br-ijn'], '4444'],
      ['st-cb2-m', 'Rizky', 'manager', ['br-cb2'], '2222'],
      ['st-cb2-k', 'Nadia', 'cashier', ['br-cb2'], '3333'],
      ['st-cb2-d', 'Joko', 'kitchen', ['br-cb2'], '4444'],
      ['st-cb3-m', 'Maya', 'manager', ['br-cb3'], '2222'],
      ['st-cb3-k', 'Fajar', 'cashier', ['br-cb3'], '3333'],
      ['st-cb3-d', 'Tono', 'kitchen', ['br-cb3'], '4444'],
    ];
    // PIN demo sama untuk peran yang sama → cukup hitung hash sekali per PIN
    const cache = {};
    for (const [, , , , pin] of people) if (!cache[pin]) cache[pin] = await hashPin(pin);
    people.forEach(([id, name, role, branchIds, pin], i) => staff.push({ id, name, role, branchIds, pin: cache[pin], active: true, color: staffColor(i) }));
  } else {
    staff.push({ id: 'st-owner', name: 'Pemilik', role: 'owner', branchIds: ['*'], pin: await hashPin(ownerPin), active: true, color: staffColor(0) });
  }
  return {
    settings: [settings], branches, categories, items, itemBranch,
    channels: DEFAULT_CHANNELS.map((c) => ({ ...c })), payMethods: DEFAULT_PAYS.map((p) => ({ ...p })), discounts, staff,
  };
}

/** PIN demo yang ditampilkan di layar login mode demo */
export const DEMO_PINS = { owner: '1111', manager: '2222', cashier: '3333 / 3344', kitchen: '4444' };
