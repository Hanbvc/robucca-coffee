/* Teks & gambar tampilan yang tidak disimpan di database (dari js/data.js prototipe lama).
   Data toko (alamat, jam, telepon, menu, harga, banner, kurir, metode bayar) datang dari API. */
import type { GroupKey } from './types';

export const CONTENT = {
  welcome: 'Mau makan atau ngopi apa hari ini?',
  heroImg: 'assets/img/hero-spread.jpg',
  storeImg: 'assets/img/venue-essentials.jpg',
  rsvImg: 'assets/img/venue-table.jpg',
  story: {
    title: 'Ramen, bento, pastry, dan kopi.',
    /** {cabang} diganti nama cabang pilihan. */
    text: 'Robucca {cabang} — tempat untuk sarapan, makan siang, nongkrong, atau kerja, dari pagi sampai malam.',
  },
  storyImgs: [
    ['assets/img/venue-essentials.jpg', 300],
    ['assets/img/venue-table.jpg', 220],
    ['assets/img/gyu-don.jpg', 170],
    ['assets/img/tantan-creamy-ramen.jpg', 170],
    ['assets/img/almond-croissant.jpg', 170],
  ] as [string, number][],
  priceNote: 'Harga sesuai buku menu Robucca 2026.',
  cupMark: 'Rbc.',
  icsDomain: 'robucca.id',
  /** Foto & keterangan area reservasi (area lain tanpa foto). */
  areas: {
    Indoor: { img: 'assets/img/venue-cups.jpg', sub: 'Ruang dalam' },
    Outdoor: { img: null, sub: 'Area luar' },
    Bebas: { img: 'assets/img/venue-table.jpg', sub: 'Mana saja' },
  } as Record<string, { img: string | null; sub: string }>,
  occasions: ['Nongkrong', 'Kerja / Meeting', 'Ulang Tahun', 'Keluarga', 'Date', 'Lainnya'],
  searchSuggest: ['Latte', 'Matcha', 'Mocktail', 'Croissant', 'Pizza', 'Fried Rice', 'Steak', 'Juice'],
};

export const GROUPS: { id: GroupKey; name: string }[] = [
  { id: 'DRINKS', name: 'Minuman' },
  { id: 'SNACK', name: 'Snack' },
  { id: 'FOOD', name: 'Makanan Berat' },
  { id: 'PASTRY', name: 'Pastry & Dessert' },
];

/** Tampilan metode bayar per kode (warna & logo teks seperti prototipe). */
export const PAY_LOOK: Record<string, { bg: string; mark: string; sub?: string }> = {
  qris: { bg: '#1C1B19', mark: 'QRIS', sub: 'Semua e-wallet & m-banking' },
  gopay: { bg: '#00A5CF', mark: 'GoPay' },
  ovo: { bg: '#4C3494', mark: 'OVO' },
  dana: { bg: '#118EEA', mark: 'DANA' },
  shopeepay: { bg: '#EE4D2D', mark: 'SPay' },
  cashier: { bg: '#9A6A3B', mark: 'KASIR', sub: 'Tunai, debit, atau kartu kredit' },
};
export const payLook = (code: string, name = code): { bg: string; mark: string; sub?: string } =>
  PAY_LOOK[code] ?? { bg: '#1C1B19', mark: name.slice(0, 5).toUpperCase() };

export const COURIER_LOOK: Record<string, { bg: string; mark: string }> = {
  gosend: { bg: '#00AA13', mark: 'GoSend' },
  grab: { bg: '#00B14F', mark: 'Grab' },
};
export const courierLook = (code: string, name = code): { bg: string; mark: string } =>
  COURIER_LOOK[code] ?? { bg: '#1C1B19', mark: name.split(' ')[0]?.slice(0, 7) ?? code };

/** Contoh alamat & penerima untuk demo (NEXT_PUBLIC_DEMO=1). Nomor contoh, bukan nomor asli. */
export const SAMPLE = {
  name: 'Jl. Soekarno Hatta (Suhat)',
  text: 'Jl. Soekarno Hatta No. 27, Jatimulyo, Kec. Lowokwaru, Kota Malang, Jawa Timur 65142',
  note: 'Ruko lantai 2, samping minimarket',
  lat: -7.9420837,
  lng: 112.6220393,
  recipient: 'Dinda Ayu Lestari',
  phone: '081200001234',
};
