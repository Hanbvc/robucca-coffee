/* Siapa yang boleh tercatat sebagai pelaku dokumen sinkron (kasir pesanan, pembuka/penutup shift, kas, log).
   Perangkat adalah batas kepercayaan: dokumen offline ditulis oleh perangkat, jadi server tidak bisa memeriksa PIN-nya.
   Aturannya:
   - Staf yang login ONLINE di perangkat ini (bukti: token sesi server dari POST /pos/login, dikirim di staffSessions)
     selalu boleh, termasuk manajer/pemilik.
   - Staf tanpa hak menyetujui (kasir, dapur) boleh tanpa bukti: hash PIN mereka memang ada di perangkat untuk login
     offline, sehingga server tidak bisa membedakan login offline yang sah dari klaim perangkat.
   - Penyetuju (manajer/pemilik) TANPA bukti sesi ditolak: hash PIN mereka tidak ada di perangkat, jadi dokumen atas
     nama mereka hanya sah bila mereka benar-benar login online di perangkat ini. Ini menutup celah "kasir mengisi
     cashierId manajer lalu menyetujui void/diskon sendiri". */
import { type DeviceCtx, type StaffCtx } from '../../common/auth';
import { verify } from '../../common/tokens';

/** Hak yang membuat staf menjadi penyetuju (hash PIN-nya tidak dikirim ke perangkat). */
export const APPROVER_PERMS = ['*', 'order.void.approve', 'order.refund.approve', 'discount.approve'];

export const isApprover = (permissions: readonly string[]): boolean => APPROVER_PERMS.some((p) => permissions.includes(p));

/** Bukti sesi tetap diterima sekian lama setelah sesi berakhir: dokumen offline bisa terkirim terlambat. */
export const SESSION_PROOF_GRACE_S = 7 * 24 * 3600;

export class Actors {
  private constructor(private readonly online: ReadonlySet<string>) {}

  /** Token sesi yang sah untuk perangkat ini → ID staf yang terbukti login online di sini. Token lain diabaikan. */
  static fromSessions(tokens: readonly string[] | undefined, device: DeviceCtx): Actors {
    const ids = new Set<string>();
    for (const t of tokens ?? []) {
      const p = verify<{ sub: string; dev?: string; typ?: string }>(t, SESSION_PROOF_GRACE_S);
      if (p && p.typ === 'sess' && p.dev === device.id && typeof p.sub === 'string') ids.add(p.sub);
    }
    return new Actors(ids);
  }

  /** Login online di perangkat ini terbukti. */
  verified(staffId: string): boolean {
    return this.online.has(staffId);
  }

  /** Staf boleh tercatat sebagai pelaku (cabang diperiksa terpisah oleh pemanggil). */
  allows(staff: Pick<StaffCtx, 'id' | 'permissions'>): boolean {
    return this.online.has(staff.id) || !isApprover(staff.permissions);
  }

  /** Pesan penolakan yang sama di semua dokumen. */
  static reason(name: string): string {
    return `${name} adalah penyetuju (manajer/pemilik): transaksi atas namanya hanya diterima bila ia login online di perangkat ini`;
  }
}
