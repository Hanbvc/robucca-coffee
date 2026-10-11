'use client';
/* Alamat pengiriman: saran Google Maps, lokasi perangkat, tautan/koordinat yang ditempel, alamat tersimpan di akun.
   Port openAddr() prototipe. Perubahan baru disimpan saat "Simpan alamat" / memilih saran. */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { useBranch } from '@/lib/data';
import { kmLabel } from '@/lib/orders';
import {
  addrKm, addrMapLink, addrMapSrc, hasAddr, isFar, isShortMapsLink, located, onPlacesFail, parseCoords, placesOn, resolve, suggest, type Sugg,
} from '@/lib/places';
import { focusLater, haptic, primeKeyboard } from '@/lib/platform';
import { useRemote } from '@/lib/remote';
import { closeSheet, openSheet } from '@/lib/sheets';
import { getState, setState, useApp, type Addr } from '@/lib/store';
import type { Branch, SavedAddress } from '@/lib/types';
import { toast } from '@/lib/ui';

function kmToast(b: Branch | null, km: number | null): void {
  if (!b) return;
  if (km == null) toast('Titik lokasi ditandai', 'map-pin');
  else if (isFar(b, km)) toast(`±${kmLabel(km)} — di luar jangkauan pengantaran`, 'map-pin');
  else toast(`Jarak ±${kmLabel(km)} dari Robucca ${b.name}`, 'map-pin');
}

function AddressSheet({ prime }: { prime: HTMLElement | null }) {
  const { branch: b } = useBranch();
  const { auth } = useApp();
  const [a, setA] = useState<Addr>(() => getState().addr);
  const latest = useRef(a);
  latest.current = a;
  const [sugg, setSugg] = useState<Sugg[]>([]);
  const [gOn, setGOn] = useState(placesOn);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState(false);
  const [mapSrc, setMapSrc] = useState(() => addrMapSrc(getState().addr, b));
  const [hint, setHint] = useState('');
  const inp = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saved = useRemote<SavedAddress[]>(auth ? 'addresses' : null, api.addresses, { maxAge: 60_000 });
  const km = addrKm(b, a);

  useEffect(
    () =>
      onPlacesFail(() => {
        setGOn(false);
        setSugg([]);
        setMapSrc(addrMapSrc(latest.current, b));
      }),
    [b],
  );
  useEffect(() => {
    if (!getState().addr.text) focusLater(inp.current, prime, 380);
    else prime?.remove();
    return () => clearTimeout(timer.current);
  }, [prime]);

  const commit = (next: Addr, after?: () => void): void => {
    setState({ addr: next });
    haptic();
    closeSheet(after);
  };

  const fetchSugg = (q: string): void => {
    const my = ++seq.current;
    void suggest(q, b).then((r) => {
      if (my === seq.current) setSugg(r);
    });
  };

  const onInput = (v: string): void => {
    setErr(false);
    setHint('');
    clearTimeout(timer.current);
    const c = parseCoords(v);
    if (c) {
      // Koordinat / tautan Google Maps panjang: langsung jadi titik.
      const next: Addr = { ...a, text: '', name: 'Titik dari Google Maps', lat: c.lat, lng: c.lng, savedId: null };
      setA(next);
      setSugg([]);
      setMapSrc(addrMapSrc(next, b));
      kmToast(b, addrKm(b, next));
      return;
    }
    if (isShortMapsLink(v)) setHint('Tautan pendek belum bisa dibaca. Buka tautannya di Google Maps lalu salin tautan panjang dari kolom alamat browser, atau pakai lokasimu.');
    const next: Addr = { ...a, text: v, name: '', savedId: null, ...(gOn ? { lat: null, lng: null } : {}) };
    setA(next);
    if (gOn) {
      const q = v.trim();
      if (q.length < 3) {
        seq.current += 1;
        setSugg([]);
        return;
      }
      timer.current = setTimeout(() => fetchSugg(q), 250);
    } else {
      timer.current = setTimeout(() => setMapSrc(addrMapSrc(latest.current, b)), 700);
    }
  };

  const pick = async (x: Sugg): Promise<void> => {
    try {
      const r = await resolve(x);
      const next: Addr = { ...latest.current, name: x.main, text: r.text, lat: r.lat, lng: r.lng, savedId: null };
      const k = addrKm(b, next);
      commit(next, () => kmToast(b, k));
    } catch {
      toast('Gagal mengambil titik dari Google Maps', 'info');
    }
  };

  const pickSaved = (x: SavedAddress): void => {
    const next: Addr = { name: x.label || x.addressText.split(',')[0]!.trim(), text: x.addressText, note: x.addressNote ?? '', lat: x.lat, lng: x.lng, savedId: x.id };
    const p = getState().profile;
    if (!p.name.trim() && !p.phone.trim()) setState({ profile: { name: x.recipientName, phone: x.recipientPhone } });
    const k = addrKm(b, next);
    commit(next, () => kmToast(b, k));
  };

  const locate = (): void => {
    if (!navigator.geolocation) {
      toast('Lokasi tidak tersedia di perangkat ini', 'info');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const cur = latest.current;
        const next: Addr = { ...cur, lat: pos.coords.latitude, lng: pos.coords.longitude, name: cur.text.trim() ? cur.name : 'Lokasi saat ini', savedId: null };
        setA(next);
        setErr(false);
        setMapSrc(addrMapSrc(next, b));
        kmToast(b, addrKm(b, next));
      },
      () => {
        setLocating(false);
        toast('Lokasi tidak diizinkan. Cari alamat atau tempel tautan Google Maps.', 'info');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  };

  const save = (): void => {
    if (!hasAddr(a)) {
      setErr(true);
      return;
    }
    const k = addrKm(b, a);
    commit(a, () => {
      if (isFar(b, k)) toast(`Alamat di luar jangkauan (maks ${b?.deliveryMaxKm} km)`, 'info');
    });
  };

  return (
    <>
      <div className="sheet-body">
        <div className="sheet-head">
          <h2>Alamat pengiriman</h2>
          <p>{gOn ? 'Cari lewat Google Maps atau pakai lokasimu sekarang.' : 'Ketik alamat, pakai lokasimu, atau tempel tautan Google Maps.'}</p>
        </div>
        <div className="sheet-pad bg-in">
          {!!saved.data?.length && (
            <div style={{ marginBottom: 12 }}>
              <div className="slot-lbl">Alamat tersimpan</div>
              {saved.data.map((x) => (
                <button key={x.id} className="saved-addr" onClick={() => pickSaved(x)}>
                  <Icon n="map-pin" cls="sm" />
                  <span className="grow">
                    <b>{x.label || x.addressText.split(',')[0]}</b>
                    <small>{x.addressText}</small>
                    <small>
                      {x.recipientName} · {x.recipientPhone}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="addr-search">
            <Icon n="search" cls="sm" />
            <input
              ref={inp}
              className={`input ${err ? 'err' : ''}`}
              id="f-addr"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCapitalize="words"
              placeholder={gOn ? 'Cari alamat di Google Maps' : 'Ketik alamat / tempel tautan Maps'}
              aria-label="Cari alamat"
              value={a.text}
              onChange={(e) => onInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                clearTimeout(timer.current);
                if (gOn && !sugg.length && a.text.trim().length >= 3) fetchSugg(a.text.trim());
                else setMapSrc(addrMapSrc(a, b));
                e.currentTarget.blur();
              }}
            />
            <span className="err-msg" hidden={!err}>
              Cari alamat atau pakai lokasimu dulu, ya.
            </span>
          </div>
          {sugg.length > 0 && (
            <div className="sugg">
              {sugg.map((x, i) => (
                <button key={i} className="sg" onClick={() => void pick(x)}>
                  <Icon n="map-pin" cls="sm" />
                  <span className="grow">
                    <b>{x.main}</b>
                    {x.sub && <small>{x.sub}</small>}
                  </span>
                </button>
              ))}
              <div className="sg-by">Hasil dari Google Maps</div>
            </div>
          )}
          {hint && (
            <div className="note-bar" style={{ margin: '10px 0 0' }}>
              <Icon n="info" cls="sm" />
              <span>{hint}</span>
            </div>
          )}
          <button className="loc-btn" onClick={locate} disabled={locating}>
            <Icon n="locate" cls="sm" />
            <span>{locating ? 'Mencari lokasimu…' : 'Pakai lokasi saya saat ini'}</span>
          </button>
          {mapSrc && (
            <div className="addr-map">
              <iframe src={mapSrc} title="Peta alamat pengiriman" loading="lazy" tabIndex={-1} />
              <a className="map-open" href={addrMapLink(a, b)} target="_blank" rel="noopener">
                <Icon n="nav" cls="xs" /> Buka di Maps
              </a>
            </div>
          )}
          {km != null && b && (
            <div className="addr-km">
              <Icon n="map-pin" cls="xs" />
              <span>
                ±{kmLabel(km)} dari Robucca {b.name}
              </span>
            </div>
          )}
          {hasAddr(a) && !located(a) && (
            <div className="note-bar" style={{ margin: '10px 0 0' }}>
              <Icon n="info" cls="sm" />
              <span>Tandai titik lokasimu agar ongkir bisa dihitung: ketuk “Pakai lokasi saya” atau tempel tautan Google Maps.</span>
            </div>
          )}
          <label className="field" style={{ marginTop: 12 }}>
            <span>
              Detail alamat <em>(opsional)</em>
            </span>
            <input className="input" placeholder="No. rumah, blok, atau patokan" maxLength={200} value={a.note} onChange={(e) => setA({ ...a, note: e.target.value })} />
          </label>
        </div>
      </div>
      <div className="sheet-foot">
        <button className="btn block" onClick={save}>
          Simpan alamat
        </button>
      </div>
    </>
  );
}

export function openAddress(): void {
  const prime = primeKeyboard();
  openSheet(<AddressSheet prime={prime} />, { full: true });
}
