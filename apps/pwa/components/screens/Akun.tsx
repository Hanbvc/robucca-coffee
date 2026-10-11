'use client';
/* Akun: profil di perangkat, masuk dengan WhatsApp & alamat tersimpan, info cabang, media sosial, pasang aplikasi,
   hapus data. Port Akun prototipe; bagian akun WhatsApp baru. */
import { useSearchParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { confirmSheet } from '@/components/Sheets';
import { logout, openAddresses, openInstall, openLogin, openProfile } from '@/components/sheets/AccountSheets';
import { openBranchPicker } from '@/components/sheets/BranchSheet';
import { openRoute, openStore } from '@/components/sheets/StoreSheet';
import { forgetTokens, useBranch, useConfig } from '@/lib/data';
import { asset, DEMO } from '@/lib/env';
import { promptInstall } from '@/lib/install';
import { handleOf, isStandalone, localPhone, shortAddress, socialUrl, telLink, waLink, waNumber } from '@/lib/platform';
import { getState, useApp, useHydrated, wipe } from '@/lib/store';
import { closeOf, dot, openOf } from '@/lib/time';
import { toast } from '@/lib/ui';

function Row({ icon, title, sub, onClick, href, ext }: { icon: string; title: ReactNode; sub?: ReactNode; onClick?: () => void; href?: string; ext?: boolean }) {
  const inner = (
    <>
      <span className="ml-i">
        <Icon n={icon} cls="sm" />
      </span>
      <span className="grow">
        {title}
        {sub && <small>{sub}</small>}
      </span>
      <Icon n="chevron-right" cls="sm" />
    </>
  );
  return href ? (
    <a className="ml" href={href} {...(ext ? { target: '_blank', rel: 'noopener' } : {})}>
      {inner}
    </a>
  ) : (
    <button className="ml" onClick={onClick}>
      {inner}
    </button>
  );
}

export function Akun() {
  const s = useApp();
  const hydrated = useHydrated();
  const q = useSearchParams();
  const { branch: b, branches } = useBranch();
  const { data: cfg } = useConfig();
  const org = cfg?.org;
  const nm = s.profile.name.trim() || s.auth?.name?.trim() || '';
  const phone = s.profile.phone.trim() || (s.auth ? localPhone(s.auth.phone) : '');
  const wa = waNumber(b);
  const insta = socialUrl('instagram', org?.instagram);
  const tiktok = socialUrl('tiktok', org?.tiktok);
  const otp = !!cfg?.otpLogin;

  // /akun/?masuk=1 (dari layar lain): langsung buka lembar masuk.
  useEffect(() => {
    if (!hydrated || q.get('masuk') !== '1') return;
    window.history.replaceState(window.history.state, '', location.pathname);
    if (!getState().auth && otp) openLogin();
  }, [hydrated, q, otp]);

  const install = (): void => {
    if (isStandalone()) {
      toast('Robucca sudah terpasang di perangkat ini', 'check');
      return;
    }
    if (promptInstall()) return;
    openInstall();
  };

  const reset = (): void =>
    confirmSheet({
      title: 'Hapus data?',
      text: 'Keranjang, riwayat pesanan, reservasi, dan profil di perangkat ini akan dihapus.',
      ok: 'Hapus',
      danger: true,
      onOk: () => {
        wipe();
        forgetTokens();
        location.reload();
      },
    });

  return (
    <div className="screen">
      <div className="acc-head">
        <h1>Akun</h1>
        <button className="card profile" style={{ width: '100%', textAlign: 'left' }} onClick={openProfile}>
          <span className="avatar">{(hydrated && nm[0]) || 'R'}</span>
          <span className="grow">
            <b>{hydrated && nm ? nm : 'Tamu Robucca'}</b>
            <small>{hydrated && phone ? phone : 'Lengkapi nama & WhatsApp untuk checkout lebih cepat'}</small>
          </span>
          <Icon n="edit" cls="sm" />
        </button>
      </div>

      {hydrated && (otp || s.auth) && (
        <>
          <div className="sec-h" style={{ marginTop: 24 }}>
            <h2>Akun WhatsApp</h2>
          </div>
          <div className="card menu-list">
            {s.auth ? (
              <>
                <Row icon="map-pin" title="Alamat tersimpan" sub="Dipakai langsung saat delivery" onClick={openAddresses} />
                <Row icon="logout" title="Keluar" sub={`Masuk sebagai ${localPhone(s.auth.phone)}`} onClick={logout} />
              </>
            ) : (
              <Row icon="login" title="Masuk dengan WhatsApp" sub="Riwayat & alamat tersimpan di semua perangkat" onClick={() => openLogin()} />
            )}
          </div>
        </>
      )}

      <div className="sec-h" style={{ marginTop: 24 }}>
        <h2>Toko{b ? ` · ${b.name}` : ''}</h2>
      </div>
      <div className="card menu-list">
        {b ? (
          <>
            <Row icon="map-pin" title="Petunjuk arah" sub={shortAddress(b.address) || `Robucca ${b.name}`} onClick={() => openRoute(b)} />
            <Row icon="clock" title="Jam buka" sub={`Setiap hari · ${dot(openOf(b))} – ${dot(closeOf(b))} WIB`} onClick={openStore} />
            {b.phone && <Row icon="phone" title="Telepon" sub={b.phone} href={telLink(b.phone)} />}
            {wa && <Row icon="chat" title="WhatsApp" sub="Tanya menu, acara & reservasi" href={waLink(wa)} ext />}
            {(branches?.length ?? 0) > 1 && <Row icon="store" title="Ganti cabang" sub={`${branches!.length} cabang Robucca`} onClick={() => openBranchPicker()} />}
          </>
        ) : (
          <Row icon="store" title="Pilih cabang" sub="Untuk melihat menu, jam buka, dan lokasi" onClick={() => openBranchPicker()} />
        )}
      </div>

      {(insta || tiktok) && (
        <>
          <div className="sec-h" style={{ marginTop: 24 }}>
            <h2>Ikuti kami</h2>
          </div>
          <div className="card menu-list">
            {insta && <Row icon="instagram" title="Instagram" sub={handleOf(org?.instagram)} href={insta} ext />}
            {tiktok && <Row icon="tiktok" title="TikTok" sub={handleOf(org?.tiktok)} href={tiktok} ext />}
          </div>
        </>
      )}

      <div className="sec-h" style={{ marginTop: 24 }}>
        <h2>Aplikasi</h2>
      </div>
      <div className="card menu-list">
        <Row icon="phone2" title="Pasang di layar utama" sub="Buka Robucca seperti aplikasi" onClick={install} />
        <Row icon="trash" title="Hapus data di perangkat ini" sub="Keranjang, riwayat & profil" onClick={reset} />
      </div>

      <div className="foot" style={{ paddingTop: 36 }}>
        <img src={asset('assets/brand/lockup-dark.png')} alt="Robucca" />
        {org?.instagram && <span>{handleOf(org.instagram)}</span>}
        {(org?.tagline || DEMO) && (
          <span style={{ display: 'block', marginTop: 10 }}>{DEMO ? 'Mode demo · alamat & penerima contoh terisi otomatis.' : org?.tagline}</span>
        )}
      </div>
    </div>
  );
}
