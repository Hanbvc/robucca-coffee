/* Modul kantor (dasbor, laporan, menu, staf, perangkat, …) menyusul.
   Kerangka ini sengaja memakai bagian yang sama dengan kasir agar layar kantor nanti tinggal disusun:
   - klien API & sesi staf: `S.be.api` (lib/api.ts, header X-Device-Token + X-Session; `S.be.ensureSession()`),
   - status login & hak akses: `S.user`, `can()` (state.ts, data/master.ts),
   - modal/drawer/toast/konfirmasi: ui/overlay.tsx, komponen kecil: ui/common.tsx,
   - detail transaksi + aksi: components/OrderDetail.tsx, cetak: components/receipt.ts. */
import { Icon } from '../lib/icons';
import { S, can, nav } from '../state';

export function OfficeHome({ params }: { params: string[] }) {
  const b = S.be.branch;
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Kantor</h1>
          <div className="crumb">{params.length ? params.join(' › ') : 'Dasbor'} · {b ? b.name : 'Kantor pusat'}</div>
        </div>
      </div>
      <div className="page">
        <div className="empty" data-office="placeholder">
          <div className="em-ico">
            <Icon name="chart" size="lg" />
          </div>
          <h3>Modul kantor menyusul</h3>
          <p>Dasbor, laporan, menu, promo, staf, perangkat, stok, dan pengaturan cabang sedang dipindahkan ke aplikasi baru.</p>
          {b && can('sell') && (
            <button className="btn" onClick={() => nav('kasir')}>
              <Icon name="grid" size="sm" /> Ke kasir
            </button>
          )}
        </div>
      </div>
    </>
  );
}
