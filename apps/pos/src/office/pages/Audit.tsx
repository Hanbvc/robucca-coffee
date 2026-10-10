/* Log aktivitas: void, refund, diskon disetujui, shift, kas, stok, perubahan menu/harga/karyawan/pengaturan. */
import { dateTime, rp } from '@robucca/core';
import { useState } from 'react';
import { Icon } from '../../lib/icons';
import { toast } from '../../ui/overlay';
import { csv, errText, fileRange, me, ms, oget, periodLabel, rangeQ, scopeLabel, tzOf } from '../lib';
import { Body, FilterBar, PageHead, useLoad } from '../ui';

interface Row { id: string; action: string; entity: string; entityId: string | null; detail: Record<string, unknown> | null; createdAt: string; branchId: string | null; branchName: string | null; actorName: string | null }
interface List { total: number; limit: number; offset: number; rows: Row[] }

const LABEL: Record<string, [string, string]> = {
  'order.void': ['Void transaksi', 'red'], 'order.refund': ['Refund', 'red'], 'line.void': ['Batal item', 'red'], 'order.price_mismatch': ['Harga tidak cocok', 'amber'],
  'discount.approve': ['Diskon disetujui', 'amber'], 'shift.open': ['Buka shift', 'green'], 'shift.close': ['Tutup shift', 'green'],
  'cash.in': ['Kas masuk', 'blue'], 'cash.out': ['Kas keluar', 'blue'],
  'stock.receive': ['Stok masuk', 'blue'], 'stock.waste': ['Barang rusak', 'blue'], 'stock.adjust': ['Opname', 'blue'], 'stock.transfer': ['Transfer stok', 'blue'], 'stock.reorder_level': ['Batas stok', 'blue'],
  'inventory.create': ['Bahan baru', ''], 'inventory.update': ['Ubah bahan', ''], 'recipe.update': ['Ubah resep', ''], 'recipe.delete': ['Hapus resep', ''],
  'menu.price.update': ['Ubah harga pusat', 'amber'], 'menu.price.branch': ['Harga/ketersediaan cabang', 'amber'], 'menu.price.option': ['Ubah harga opsi', 'amber'],
  'menu.availability': ['Ketersediaan menu', ''], 'menu.soldout': ['Menu habis', ''], 'menu.available': ['Menu tersedia', ''],
  'menu.product.create': ['Menu baru', ''], 'menu.product.update': ['Ubah menu', ''], 'menu.product.modifiers': ['Opsi menu', ''], 'menu.category.create': ['Kategori baru', ''],
  'menu.category.update': ['Ubah kategori', ''], 'menu.modifier.create': ['Grup opsi baru', ''], 'menu.modifier.update': ['Ubah grup opsi', ''], 'menu.option.create': ['Pilihan baru', ''], 'menu.option.update': ['Ubah pilihan', ''],
  'promo.create': ['Promo baru', ''], 'promo.update': ['Ubah promo', ''], 'promo.delete': ['Hapus promo', ''], 'promo.deactivate': ['Nonaktifkan promo', ''],
  'staff.create': ['Karyawan baru', ''], 'staff.update': ['Ubah karyawan', ''], 'staff.pin': ['Ganti PIN', 'amber'], 'staff.password': ['Ganti password', 'amber'],
  'device.create': ['Perangkat baru', ''], 'device.pair': ['Pasang perangkat', ''], 'device.repair': ['Kode pasang ulang', ''], 'device.revoke': ['Cabut perangkat', 'red'],
  'branch.create': ['Cabang baru', ''], 'branch.update': ['Ubah cabang', ''], 'settings.update': ['Ubah pengaturan', ''], 'channel.create': ['Tipe pesanan baru', ''],
  'channel.update': ['Ubah tipe pesanan', ''], 'channel.markup.update': ['Ubah markup ojol', 'amber'], 'payment_option.create': ['Metode bayar baru', ''], 'payment_option.update': ['Ubah metode bayar', ''],
  'courier.create': ['Kurir baru', ''], 'courier.update': ['Ubah kurir', ''], 'banner.create': ['Banner baru', ''], 'banner.update': ['Ubah banner', ''], 'banner.delete': ['Hapus banner', ''],
};
const label = (a: string): [string, string] => LABEL[a] ?? [a, ''];
const money = (v: unknown) => (typeof v === 'number' ? rp(v) : String(v ?? ''));

function detail(a: Row): string {
  const d = a.detail ?? {};
  const s = (k: string) => (d[k] == null ? '' : String(d[k]));
  switch (a.action) {
    case 'order.void':
    case 'order.refund':
      return [s('number'), d.total != null ? money(d.total) : d.amount != null ? money(d.amount) : '', d.reason ? `“${s('reason')}”` : ''].filter(Boolean).join(' · ');
    case 'shift.open':
      return `Kas awal ${money(d.openingCash ?? 0)}`;
    case 'shift.close':
      return `Dihitung ${money(d.countedCash ?? 0)}${d.note ? ` · “${s('note')}”` : ''}`;
    case 'menu.price.branch':
    case 'menu.price.update':
      return [s('name'), d.from !== undefined || d.to !== undefined ? `${d.from == null ? 'harga pusat' : money(d.from)} → ${d.to == null ? 'harga pusat' : money(d.to)}` : '', d.isAvailable !== undefined ? (d.isAvailable ? 'tersedia' : 'tidak tersedia') : ''].filter(Boolean).join(' · ');
    default: {
      const name = s('name') || s('item') || s('sku');
      const rest = Object.entries(d)
        .filter(([k]) => !['name', 'item'].includes(k))
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join(' · ');
      return [name, rest].filter(Boolean).join(' · ').slice(0, 220);
    }
  }
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [central, setCentral] = useState(false);
  const acts = useLoad(() => oget<{ action: string; count: number }[]>('/office/audit/actions'), []);
  const q = () => rangeQ({ action, central: central || undefined, limit: 500 });
  const l = useLoad(() => oget<List>(`/office/audit${q()}`), [action, central]);
  return (
    <>
      <PageHead
        title="Log aktivitas"
        sub={`${central ? 'Kantor pusat' : scopeLabel()} · ${periodLabel()}`}
        actions={
          <button className="btn ghost sm" data-csv onClick={() => csv(`/office/audit${rangeQ({ action, central: central || undefined, limit: 5000 })}`, `robucca-log-${fileRange()}`).catch((e: unknown) => toast(errText(e), 'err'))}>
            <Icon name="download" size="sm" /> Ekspor CSV
          </button>
        }
      />
      <div className="page">
        <FilterBar
          branch={!central}
          extra={
            <>
              <span className="sep" />
              <select className="select sm" data-action aria-label="Aktivitas" value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="">Semua aktivitas</option>
                {[...new Set((acts.data ?? []).map((a) => a.action.split('.')[0]!))].map((p) => (
                  <option key={p} value={`${p}.`}>
                    {p}.* (semua)
                  </option>
                ))}
                {(acts.data ?? []).map((a) => (
                  <option key={a.action} value={a.action}>
                    {label(a.action)[0]} ({a.count})
                  </option>
                ))}
              </select>
              {me().allBranches && (
                <label className="row" style={{ gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={central} onChange={(e) => setCentral(e.target.checked)} /> Hanya perubahan pusat
                </label>
              )}
            </>
          }
        />
        <Body l={l}>
          {(d) => (
            <div className="table-card" id="a-table">
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Cabang</th>
                      <th>Oleh</th>
                      <th>Aktivitas</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.length ? (
                      d.rows.map((a) => {
                        const [t, c] = label(a.action);
                        return (
                          <tr key={a.id} data-action={a.action}>
                            <td className="n">{dateTime(ms(a.createdAt), tzOf(a.branchId))}</td>
                            <td>{a.branchName ?? 'Pusat'}</td>
                            <td>{a.actorName ?? '-'}</td>
                            <td>
                              <span className={`tag ${c}`}>{t}</span>
                            </td>
                            <td style={{ maxWidth: 460 }}>{detail(a)}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                          Belum ada aktivitas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {d.total > d.rows.length && (
                <div className="pager">
                  <span>
                    Menampilkan {d.rows.length} dari {d.total} aktivitas — persempit periode atau ekspor CSV untuk semuanya.
                  </span>
                </div>
              )}
            </div>
          )}
        </Body>
      </div>
    </>
  );
}
