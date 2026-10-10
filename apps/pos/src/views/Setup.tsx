/* Penyiapan perangkat: mode demo atau pasangkan ke server pusat (kode 6 digit). Port dari pos/js/views/setup.js. */
import { useEffect, useState } from 'react';
import { defaultApiUrl, isOffline } from '../lib/api';
import { Icon } from '../lib/icons';
import { S, setUser } from '../state';
import { toast } from '../ui/overlay';
import { DEMO_BRANCHES } from '../data/demo-info';

export function SetupView() {
  const [mode, setMode] = useState<'demo' | 'server'>('server');
  const [branch, setBranch] = useState('IJN');
  const [url, setUrl] = useState(defaultApiUrl());
  const [code, setCode] = useState('');
  const [name, setName] = useState('Kasir');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [working, setWorking] = useState(false);

  // Server menjawab? → mode server; bila tidak (mis. dibuka tanpa API) → mode demo.
  useEffect(() => {
    let live = true;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    fetch(`${defaultApiUrl()}/health`, { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        if (live && !j) setMode('demo');
      })
      .catch(() => {
        if (live) setMode('demo');
      })
      .finally(() => clearTimeout(t));
    return () => {
      live = false;
      ctrl.abort();
    };
  }, []);

  /** Perangkat siap → layar login (tanpa muat ulang halaman). */
  const done = () => {
    history.replaceState(null, '', '#/masuk');
    setUser(null);
  };

  const startDemo = async () => {
    setWorking(true);
    try {
      await S.be.setupDemo({ branchCode: branch, onProgress: setMsg });
      done();
    } catch (e) {
      console.error(e);
      setMsg(`Gagal menyiapkan demo: ${(e as Error).message || e}`);
      setWorking(false);
    }
  };

  const pair = async () => {
    const u = url.trim().replace(/\/+$/, '');
    const c = code.replace(/\D/g, '');
    setErr('');
    if (!/^https?:\/\//.test(u)) return setErr('Alamat server harus diawali http:// atau https://');
    if (c.length !== 6) return setErr('Kode pasang terdiri dari 6 angka.');
    setWorking(true);
    try {
      await S.be.pair({ url: u, code: c, name: name.trim() || 'Kasir' });
      toast('Perangkat terpasang');
      S.be.startSync();
      done();
    } catch (x) {
      setErr(isOffline(x) ? `Tidak bisa menghubungi ${u}. Periksa alamat & koneksi.` : (x as Error).message);
      setWorking(false);
    }
  };

  return (
    <div className="split">
      <section className="brand-side">
        <img className="logo" src="assets/brand/wordmark-light.png" alt="Robucca" />
        <h1>
          Kasir untuk
          <br />
          semua cabang
        </h1>
        <p>Penjualan, dapur, shift kas, dan antrean dalam satu sistem. Tetap bisa berjualan saat internet putus — data dikirim ke pusat begitu online.</p>
        <div className="meta">
          <span className="pill">
            <Icon name="grid" size="xs" /> Kasir · <Icon name="chef" size="xs" /> Dapur · <Icon name="chart" size="xs" /> Kantor
          </span>
          <span>Rbc Group</span>
        </div>
      </section>
      <section className="main-side">
        <h2>Siapkan perangkat ini</h2>
        <p className="lead">Pilih cara memakai POS di perangkat ini. Pengaturan ini hanya dilakukan sekali.</p>
        <div className="mode-cards" role="radiogroup">
          <button className={`mode-card ${mode === 'demo' ? 'on' : ''}`} data-mode="demo" role="radio" aria-checked={mode === 'demo'} onClick={() => setMode('demo')}>
            <span className="mc-ico">
              <Icon name="star" />
            </span>
            <b>Coba mode demo</b>
            <p>Tiga cabang contoh, staf contoh, dan riwayat transaksi 14 hari (simulasi). Data hanya di perangkat ini, tanpa server.</p>
          </button>
          <button className={`mode-card ${mode === 'server' ? 'on' : ''}`} data-mode="server" role="radio" aria-checked={mode === 'server'} onClick={() => setMode('server')}>
            <span className="mc-ico">
              <Icon name="cloud" />
            </span>
            <b>Hubungkan ke server pusat</b>
            <p>Untuk operasional sungguhan: semua cabang memakai satu database. Butuh kode pasang 6 digit dari kantor pusat.</p>
          </button>
        </div>
        <div className="setup-form" id="setup-form">
          {mode === 'demo' ? (
            <>
              <div className="field-label" style={{ marginBottom: 8 }}>
                Perangkat ini menjadi kasir cabang
              </div>
              <div className="branch-pick">
                {DEMO_BRANCHES.map((b) => (
                  <button key={b.code} className={`branch-opt ${branch === b.code ? 'on' : ''}`} data-branch={b.code} onClick={() => setBranch(b.code)}>
                    <b>{b.name}</b>
                    <small>{b.sub}</small>
                  </button>
                ))}
              </div>
              <p className="hint" style={{ margin: '10px 0 16px' }}>
                Cabang bisa diganti nanti dari menu pengguna.
              </p>
              <button className="btn lg" data-go="demo" disabled={working} onClick={() => void startDemo()}>
                <Icon name="arrow-right" size="sm" /> Mulai demo
              </button>
              {msg && (
                <p className="hint" style={{ marginTop: 12 }}>
                  {msg}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="form-grid">
                <label className="field full">
                  <span>Alamat server</span>
                  <input className="input" id="f-url" inputMode="url" autoComplete="url" placeholder="https://pos.robucca.id/api" value={url} onChange={(e) => setUrl(e.target.value)} />
                </label>
                <label className="field">
                  <span>
                    Kode pasang <em>(6 digit, dari kantor pusat)</em>
                  </span>
                  <input
                    className="input"
                    id="f-code"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void pair();
                    }}
                  />
                </label>
                <label className="field">
                  <span>Nama perangkat</span>
                  <input className="input" id="f-name" placeholder="mis. Kasir depan" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
              </div>
              {err && (
                <p className="err-text" id="f-err" style={{ marginTop: 10 }}>
                  {err}
                </p>
              )}
              <div className="row" style={{ marginTop: 16 }}>
                <button className="btn lg" data-go="pair" disabled={working} onClick={() => void pair()}>
                  <Icon name="link" size="sm" /> Pasangkan perangkat
                </button>
              </div>
              <div className="note blue" style={{ marginTop: 16 }}>
                <Icon name="info" size="sm" />
                <span>
                  Kode pasang dibuat di kantor pusat (atau di server: <b>node apps/api/dist/cli/pair.js --branch IJN --terminal 1</b>), berlaku 15 menit dan hanya sekali
                  pakai.
                </span>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
