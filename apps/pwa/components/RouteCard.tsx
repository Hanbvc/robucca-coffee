'use client';
/* Kartu rute delivery: cabang → alamat tujuan, jarak & jangkauan. Port routeHTML() prototipe. */
import { Icon } from '@/components/Icon';
import { openAddress } from '@/components/sheets/AddressSheet';
import { openStore } from '@/components/sheets/StoreSheet';
import { useBranch } from '@/lib/data';
import { kmLabel } from '@/lib/orders';
import { addrKm, addrLines, hasAddr, isFar } from '@/lib/places';
import { useApp } from '@/lib/store';

export function RouteCard({ compact = false, onPickup }: { compact?: boolean; onPickup: () => void }) {
  const s = useApp();
  const { branch: b } = useBranch();
  if (!b) return null;
  const km = addrKm(b, s.addr);
  const far = isFar(b, km);
  const al = addrLines(s.addr);
  const status =
    km == null ? (
      hasAddr(s.addr) ? (
        'Titik lokasi belum ada · pakai lokasimu'
      ) : (
        'Jarak dihitung setelah alamat dipilih'
      )
    ) : (
      <>
        {kmLabel(km)} • <span className={far ? 'bad' : 'ok'}>{far ? 'Diluar jangkauan' : 'Dalam jangkauan'}</span>
      </>
    );
  return (
    <>
      <div className="card route">
        <button className="rt-row" onClick={() => openStore()}>
          <span className="rt-ic store">
            <Icon n="store" />
          </span>
          <span className="grow">
            <b>Robucca {b.name}</b>
            <small>{status}</small>
          </span>
          <Icon n="chevron-right" cls="sm" />
        </button>
        <button className="rt-row" onClick={() => openAddress()}>
          <span className="rt-ic pin">
            <Icon n="map-pin" />
          </span>
          <span className="grow">
            <b>{al.title}</b>
            <small className={compact ? 'clamp1' : 'clamp2'}>{al.sub}</small>
          </span>
          <Icon n="chevron-right" cls="sm" />
        </button>
      </div>
      {far && (
        <div className="oor">
          <h3>Di Luar Jangkauan Pengiriman</h3>
          <p>Jarak pengiriman melebihi batas maksimal {b.deliveryMaxKm} km. Silakan ubah alamat atau pesan dengan layanan Pick Up.</p>
          <div className="oor-b">
            <button className="btn ghost" onClick={onPickup}>
              Pick Up
            </button>
            <button className="btn" onClick={() => openAddress()}>
              Ubah Alamat
            </button>
          </div>
        </div>
      )}
    </>
  );
}
