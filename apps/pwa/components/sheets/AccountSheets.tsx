'use client';
/* Lembar akun: profil di perangkat, masuk dengan WhatsApp (OTP), alamat tersimpan, pasang di layar utama.
   Profil & pasang = port openProfile()/install prototipe; masuk WhatsApp & alamat tersimpan baru (akun pelanggan di server). */
import { normalizePhone } from '@robucca/core';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { confirmSheet } from '@/components/Sheets';
import { api, errText } from '@/lib/api';
import { focusLater, isIOS, localPhone, primeKeyboard } from '@/lib/platform';
import { forget, mutate, peek, useRemote } from '@/lib/remote';
import { closeSheet, openSheet } from '@/lib/sheets';
import { getState, setState, useApp } from '@/lib/store';
import type { SavedAddress } from '@/lib/types';
import { toast } from '@/lib/ui';

// --- Profil ---------------------------------------------------------------------------

function ProfileSheet() {
  const init = getState();
  const [name, setName] = useState(init.profile.name);
  const [phone, setPhone] = useState(init.profile.phone);
  const [bad, setBad] = useState(false);

  const save = (): void => {
    const n = name.trim();
    const p = phone.trim();
    if (p && !normalizePhone(p)) {
      setBad(true);
      return;
    }
    setState({ profile: { name: n, phone: p } });
    // Sudah masuk: nama akun ikut diperbarui (tidak wajib berhasil; profil di perangkat sudah tersimpan).
    const auth = getState().auth;
    if (auth && n.length >= 2 && n !== auth.name) {
      void api
        .saveName(n)
        .then((c) => setState((s) => (s.auth ? { auth: { ...s.auth, name: c.name } } : {})))
        .catch(() => {});
    }
    closeSheet(() => toast('Profil tersimpan'));
  };

  return (
    <>
      <div className="sheet-body bg-in">
        <div className="sheet-head">
          <h2>Profil kamu</h2>
          <p>
            Dipakai otomatis saat checkout &amp; reservasi.{' '}
            {init.auth ? 'Nama juga disimpan di akun WhatsApp-mu.' : 'Tersimpan hanya di perangkat ini.'}
          </p>
        </div>
        <div className="sheet-pad form-grid">
          <label className="field">
            <span>Nama</span>
            <input className="input" autoComplete="name" placeholder="Nama kamu" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>No. WhatsApp</span>
            <input
              className={`input ${bad ? 'err' : ''}`}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="08xxxxxxxxxx"
              maxLength={20}
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setBad(false);
              }}
            />
            <span className="err-msg" hidden={!bad}>
              Nomor WhatsApp belum valid.
            </span>
          </label>
        </div>
      </div>
      <div className="sheet-foot">
        <button className="btn block" onClick={save}>
          Simpan
        </button>
      </div>
    </>
  );
}

export function openProfile(): void {
  openSheet(<ProfileSheet />);
}

// --- Masuk dengan WhatsApp ---------------------------------------------------------------

const RESEND_S = 30;

function LoginSheet({ prime, then }: { prime: HTMLInputElement | null; then?: () => void }) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState(() => getState().profile.phone);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ phone: string; devCode?: string } | null>(null);
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const primed = useRef<HTMLInputElement | null>(prime);

  // Fokus ke kolom yang aktif (iPhone: keyboard dibuka lewat input sementara dari ketukan sebelumnya).
  useEffect(() => {
    focusLater(step === 'code' ? codeRef.current : phoneRef.current, primed.current, step === 'code' ? 60 : 360);
    primed.current = null;
  }, [step]);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const send = async (): Promise<void> => {
    if (busy) return;
    if (!normalizePhone(phone)) {
      setErr('Nomor WhatsApp belum valid.');
      return;
    }
    primed.current = step === 'phone' ? primeKeyboard() : null;
    setBusy(true);
    setErr('');
    try {
      const r = await api.otp(phone.trim());
      setSent({ phone: r.phone, devCode: r.devCode });
      setCode('');
      setLeft(RESEND_S);
      setStep('code');
      if (step === 'code') toast('Kode baru dikirim', 'chat');
    } catch (e) {
      primed.current?.remove();
      primed.current = null;
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (c: string): Promise<void> => {
    if (busy || !sent) return;
    if (!/^\d{6}$/.test(c)) {
      setErr('Masukkan 6 digit kode dari WhatsApp.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const nm = getState().profile.name.trim();
      const r = await api.verify(sent.phone, c, nm.length >= 2 ? nm : undefined);
      setState((s) => ({
        auth: { token: r.token, phone: r.customer.phone, name: r.customer.name },
        profile: { name: s.profile.name.trim() || r.customer.name || '', phone: s.profile.phone.trim() || localPhone(r.customer.phone) },
      }));
      forget('addresses');
      codeRef.current?.blur();
      closeSheet(() => {
        toast('Berhasil masuk', 'check');
        then?.();
      });
    } catch (e) {
      setErr(errText(e));
      setCode('');
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  if (step === 'phone') {
    return (
      <>
        <div className="sheet-body bg-in">
          <div className="sheet-head">
            <h2>Masuk dengan WhatsApp</h2>
            <p>Riwayat pesanan, reservasi, dan alamat tersimpan bisa dibuka dari perangkat mana pun.</p>
          </div>
          <div className="sheet-pad form-grid">
            <label className="field">
              <span>No. WhatsApp</span>
              <input
                ref={phoneRef}
                className={`input ${err ? 'err' : ''}`}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="send"
                placeholder="08xxxxxxxxxx"
                maxLength={20}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setErr('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <span className="err-msg" hidden={!err}>
                {err}
              </span>
            </label>
            <p className="faint" style={{ margin: 0, fontSize: 12 }}>
              Kami kirim kode 6 digit ke WhatsApp ini. Tanpa masuk pun kamu tetap bisa memesan sebagai tamu.
            </p>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn block" disabled={busy} onClick={() => void send()}>
            {busy ? 'Mengirim kode…' : 'Kirim kode'}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="sheet-body bg-in">
        <div className="sheet-head">
          <h2>Masukkan kode</h2>
          <p>Kode 6 digit dikirim ke WhatsApp {sent ? localPhone(sent.phone) : ''}. Berlaku 5 menit.</p>
        </div>
        <div className="sheet-pad">
          <input
            ref={codeRef}
            className={`input otp-input ${err ? 'err' : ''}`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="done"
            aria-label="Kode OTP"
            placeholder="••••••"
            maxLength={6}
            value={code}
            readOnly={busy}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(v);
              setErr('');
              if (v.length === 6) void verify(v);
            }}
          />
          <span className="err-msg" hidden={!err} style={{ textAlign: 'center' }}>
            {err}
          </span>
          {sent?.devCode && <div className="otp-dev">Mode pengembangan · kode: {sent.devCode}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontSize: 13 }}>
            <button
              className="text-btn"
              onClick={() => {
                setStep('phone');
                setErr('');
              }}
            >
              Ganti nomor
            </button>
            <button className="text-btn" disabled={left > 0 || busy} style={left > 0 ? { opacity: 0.5, textDecoration: 'none' } : undefined} onClick={() => void send()}>
              {left > 0 ? `Kirim ulang (${left})` : 'Kirim ulang kode'}
            </button>
          </div>
        </div>
      </div>
      <div className="sheet-foot">
        <button className="btn block" disabled={busy || code.length !== 6} onClick={() => void verify(code)}>
          {busy ? 'Memeriksa…' : 'Masuk'}
        </button>
      </div>
    </>
  );
}

/** Buka lembar masuk; `then` dijalankan setelah berhasil masuk. Dipanggil langsung dari ketukan (keyboard iPhone). */
export function openLogin(then?: () => void): void {
  const prime = primeKeyboard();
  openSheet(<LoginSheet prime={prime} then={then} />);
}

/** Keluar akun: token & data akun di memori dibuang, data tamu di perangkat tetap. */
export function logout(): void {
  confirmSheet({
    title: 'Keluar dari akun?',
    text: 'Riwayat dari akun tidak tampil lagi di perangkat ini sampai kamu masuk kembali. Profil, keranjang, dan pesanan sebagai tamu tetap tersimpan.',
    ok: 'Keluar',
    danger: true,
    onOk: () => {
      setState((s) => ({ auth: null, addr: { ...s.addr, savedId: null } }));
      forget('addresses');
      forget('order:');
      forget('rsv:');
      forget('activity');
      toast('Kamu sudah keluar', 'logout');
    },
  });
}

// --- Alamat tersimpan ---------------------------------------------------------------------

function AddressesSheet() {
  const { auth } = useApp();
  const { data, error, loading, reload } = useRemote<SavedAddress[]>(auth ? 'addresses' : null, api.addresses, { maxAge: 60_000 });

  const del = (x: SavedAddress): void =>
    confirmSheet({
      title: 'Hapus alamat ini?',
      text: x.addressText,
      ok: 'Hapus',
      danger: true,
      onOk: () => {
        void (async () => {
          try {
            await api.deleteAddress(x.id);
            mutate(
              'addresses',
              (peek<SavedAddress[]>('addresses') ?? []).filter((a) => a.id !== x.id),
            );
            if (getState().addr.savedId === x.id) setState((s) => ({ addr: { ...s.addr, savedId: null } }));
            toast('Alamat dihapus', 'trash');
          } catch (e) {
            toast(errText(e), 'info');
            void reload();
          }
        })();
      },
    });

  let body;
  if (!data && loading) body = [0, 1].map((i) => <div key={i} className="skel" style={{ height: 64, marginTop: 10 }} />);
  else if (!data)
    body = (
      <div className="note-bar" style={{ margin: 0 }}>
        <Icon n="info" cls="sm" />
        <span>
          {error ?? 'Alamat belum bisa dimuat.'}{' '}
          <button className="text-btn" onClick={() => void reload()}>
            Coba lagi
          </button>
        </span>
      </div>
    );
  else if (!data.length)
    body = (
      <p className="faint" style={{ margin: 0, fontSize: 13 }}>
        Belum ada alamat tersimpan. Alamat delivery otomatis tersimpan di akunmu setiap kali kamu memesan delivery dalam keadaan masuk.
      </p>
    );
  else
    body = data.map((x) => (
      <div key={x.id} className="saved-addr">
        <Icon n="map-pin" cls="sm" />
        <span className="grow">
          <b>{x.label || x.addressText.split(',')[0]}</b>
          <small>{x.addressText}</small>
          {x.addressNote && <small>{x.addressNote}</small>}
          <small>
            {x.recipientName} · {x.recipientPhone}
          </small>
        </span>
        <button className="icon-btn" aria-label={`Hapus alamat ${x.label || x.addressText.split(',')[0]}`} onClick={() => del(x)}>
          <Icon n="trash" cls="sm" />
        </button>
      </div>
    ));

  return (
    <div className="sheet-body">
      <div className="sheet-head">
        <h2>Alamat tersimpan</h2>
        <p>Pilih langsung saat checkout delivery. Tersimpan di akunmu, bukan hanya di perangkat ini.</p>
      </div>
      <div className="sheet-pad" style={{ paddingBottom: 'calc(24px + var(--safe-b))' }}>
        {body}
      </div>
    </div>
  );
}

export function openAddresses(): void {
  openSheet(<AddressesSheet />);
}

// --- Pasang di layar utama ---------------------------------------------------------------

function InstallSheet() {
  const ios = isIOS();
  return (
    <>
      <div className="sheet-body">
        <div className="sheet-head">
          <h2>Pasang di layar utama</h2>
          <p>Akses Robucca dengan satu ketukan, seperti aplikasi.</p>
        </div>
        <div className="sheet-pad">
          <ol className="steps-ol">
            {ios ? (
              <>
                <li>
                  <span>
                    Ketuk tombol <b>Bagikan</b> <Icon n="share" cls="xs" /> di Safari.
                  </span>
                </li>
                <li>
                  <span>
                    Pilih <b>Tambah ke Layar Utama</b>.
                  </span>
                </li>
                <li>
                  <span>
                    Ketuk <b>Tambah</b>.
                  </span>
                </li>
              </>
            ) : (
              <>
                <li>Buka menu browser (ikon ⋮).</li>
                <li>
                  <span>
                    Pilih <b>Instal aplikasi</b> atau <b>Tambahkan ke layar utama</b>.
                  </span>
                </li>
                <li>Konfirmasi.</li>
              </>
            )}
          </ol>
        </div>
      </div>
      <div className="sheet-foot">
        <button className="btn block" onClick={() => closeSheet()}>
          Mengerti
        </button>
      </div>
    </>
  );
}

export function openInstall(): void {
  openSheet(<InstallSheet />);
}
