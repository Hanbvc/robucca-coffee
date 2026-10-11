'use client';
/* Info cabang: foto, buka/tutup, alamat, rute/telepon/chat, jam buka per hari, peta, ganti cabang. Port openStore(). */
import { DAYS } from '@robucca/core';
import { Icon } from '@/components/Icon';
import { Pic } from '@/components/Pic';
import { openBranchPicker } from '@/components/sheets/BranchSheet';
import { CONTENT } from '@/lib/content';
import { useBranch } from '@/lib/data';
import { branchMaps, isIOS, telLink, waLink, waNumber } from '@/lib/platform';
import { closeSheet, openSheet } from '@/lib/sheets';
import { closeOf, dot, isOpen, nowAt, openOf } from '@/lib/time';
import type { Branch } from '@/lib/types';

export function HoursTable({ b }: { b: Branch }) {
  const today = nowAt(b.timezone).dow;
  return (
    <table className="hours">
      <tbody>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <tr key={d} className={d === today ? 'today' : undefined}>
            <td>
              {DAYS[d]}
              {d === today && (
                <span className="tag olive" style={{ marginLeft: 4 }}>
                  Hari ini
                </span>
              )}
            </td>
            <td>
              {dot(openOf(b))} – {dot(closeOf(b))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StoreSheet() {
  const { branch: b, branches } = useBranch();
  if (!b) {
    return (
      <div className="sheet-body">
        <div className="sheet-head">
          <h2>Pilih cabang</h2>
          <p>Pilih cabang Robucca terdekat untuk melihat menu, jam buka, dan lokasi.</p>
        </div>
        <div className="sheet-pad">
          <button className="btn block" onClick={() => closeSheet(() => openBranchPicker())}>
            <Icon n="store" cls="sm" /> Pilih cabang
          </button>
        </div>
      </div>
    );
  }
  const open = isOpen(b);
  const maps = branchMaps(b);
  const wa = waNumber(b);
  return (
    <div className="sheet-body">
      <button className="sheet-x" onClick={() => closeSheet()} aria-label="Tutup">
        <Icon n="x" />
      </button>
      <Pic src={CONTENT.storeImg} cls="pd-img" style={{ aspectRatio: '16/10' }} eager />
      <div className="pd-head">
        <div className="tags">
          <span className={`tag ${open ? 'olive' : 'red'}`}>
            <i className="dot" />
            {open ? 'Buka sekarang' : 'Sedang tutup'}
          </span>
        </div>
        <h2>Robucca {b.name}</h2>
        <p>{b.address || 'Alamat belum diisi.'}</p>
      </div>
      <div className="sheet-pad">
        <div className="btn-row" style={{ margin: '6px 0 18px' }}>
          <button className="btn soft" onClick={() => openRoute(b)}>
            <Icon n="nav" cls="sm" /> Rute
          </button>
          {b.phone && (
            <a className="btn soft" href={telLink(b.phone)}>
              <Icon n="phone" cls="sm" /> Telepon
            </a>
          )}
          {wa && (
            <a className="btn soft" href={waLink(wa)} target="_blank" rel="noopener">
              <Icon n="chat" cls="sm" /> Chat
            </a>
          )}
        </div>
        <b style={{ display: 'block', marginBottom: 6 }}>Jam buka</b>
        <HoursTable b={b} />
        <iframe
          src={maps.embed}
          loading="lazy"
          title="Peta"
          style={{ display: 'block', width: '100%', height: 190, border: 0, borderRadius: 16, marginTop: 16, background: 'var(--sand)' }}
        />
        {(branches?.length ?? 0) > 1 && (
          <button className="btn block soft" style={{ marginTop: 16 }} onClick={() => closeSheet(() => openBranchPicker())}>
            <Icon n="store" cls="sm" /> Ganti cabang
          </button>
        )}
      </div>
    </div>
  );
}

export function openStore(): void {
  openSheet(<StoreSheet />, { handleOnImg: true });
}

// --- Petunjuk arah --------------------------------------------------------------------

function RouteSheet({ b }: { b: Branch }) {
  const maps = branchMaps(b);
  const row = (href: string, ic: string, name: string, sub: string) => (
    <a className="ml" href={href} target="_blank" rel="noopener" key={name}>
      <span className="ml-i">
        <Icon n={ic} cls="sm" />
      </span>
      <span className="grow">
        {name}
        <small>{sub}</small>
      </span>
      <Icon n="chevron-right" cls="sm" />
    </a>
  );
  const q = encodeURIComponent(`Robucca ${b.name}`);
  return (
    <div className="sheet-body">
      <div className="sheet-head">
        <h2>Petunjuk arah</h2>
        <p>{b.address || `Robucca ${b.name}`}</p>
      </div>
      <div className="sheet-pad">
        <div className="menu-list" style={{ margin: 0, padding: 0 }}>
          {isIOS() && row(maps.ll ? `https://maps.apple.com/?daddr=${maps.ll}&dirflg=d&q=${q}` : `https://maps.apple.com/?q=${q}`, 'map-pin', 'Apple Maps', 'Bawaan iPhone')}
          {row(maps.url, 'nav', 'Google Maps', 'Rute & ulasan')}
          {maps.ll && row(`https://waze.com/ul?ll=${maps.ll}&navigate=yes`, 'nav', 'Waze', 'Navigasi berkendara')}
        </div>
      </div>
    </div>
  );
}

export function openRoute(b: Branch): void {
  openSheet(<RouteSheet b={b} />);
}
