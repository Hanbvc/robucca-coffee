'use client';
/* Menu pelanggan hanya untuk dilihat (tanpa memesan): QR di meja, tautan di bio Instagram, tablet, atau TV di kasir.
   Port menu/menu.js prototipe. Kelompok: Minuman → Snack → Makanan Berat → Pastry & Dessert.
   Harga & ketersediaan langsung dari kasir cabang (?cabang=KODE), diperbarui tiap menit. */
import { optionNotes, rp, tzLabel } from '@robucca/core';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { api } from '@/lib/api';
import { GROUPS } from '@/lib/content';
import { menuKey, useBranches, useConfig } from '@/lib/data';
import { asset } from '@/lib/env';
import { catKey, displayPrice, norm, priceNote } from '@/lib/menu';
import { handleOf } from '@/lib/platform';
import { useRemote } from '@/lib/remote';
import { at, isOpen } from '@/lib/time';
import type { Branch, Category, Menu, Product } from '@/lib/types';
import { useTick } from '@/lib/ui';

const REFRESH_MS = 60_000;

interface Cat {
  id: string;
  key: string;
  name: string;
  items: Product[];
}
interface Group {
  id: string;
  name: string;
  cats: Cat[];
}

function groupsOf(menu: Menu): Group[] {
  const by = new Map<string, Category[]>();
  for (const c of menu.categories) {
    if (!c.products.length) continue;
    by.set(c.group, [...(by.get(c.group) ?? []), c]);
  }
  return GROUPS.filter((g) => by.has(g.id)).map((g) => ({
    id: g.id,
    name: g.name,
    cats: by.get(g.id)!.map((c) => ({ id: c.id, key: catKey(c), name: c.name, items: c.products })),
  }));
}

const initials = (s: string): string =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
const smooth = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
const dot = (t: string | null | undefined): string => String(t ?? '').replace(':', '.');

function Thumb({ p }: { p: Product }) {
  const url = p.imageUrl ? asset(p.imageUrl) : '';
  const [state, setState] = useState<'wait' | 'ok' | 'bad'>('wait');
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth) setState('ok');
  }, []);
  return (
    <div className="im" aria-hidden="true">
      {url && state !== 'bad' ? (
        <img
          ref={ref}
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          width={76}
          height={76}
          className={state === 'ok' ? 'ok' : undefined}
          onLoad={() => setState('ok')}
          onError={() => setState('bad')}
        />
      ) : (
        initials(p.name)
      )}
    </div>
  );
}

function Item({ p, cat, star = true }: { p: Product; cat?: string; star?: boolean }) {
  const notes = optionNotes(p);
  return (
    <article className={`item${p.available ? '' : ' out'}`}>
      <Thumb p={p} />
      <div>
        <h4>
          {p.name}
          {star && p.isSignature && (
            <>
              {' '}
              <span className="star" role="img" aria-label="Signature">
                ★
              </span>
            </>
          )}
        </h4>
        {cat && <div className="where-cat">{cat}</div>}
        {notes.length > 0 && (
          <div className="opts">
            {notes.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
        )}
      </div>
      <div className="pr">
        <b>{rp(displayPrice(p))}</b>
        {!p.available && (
          <>
            <br />
            <span className="habis">Habis</span>
          </>
        )}
      </div>
    </article>
  );
}

/** Tandai tepi bilah yang masih bisa digeser (dipudarkan lewat CSS). */
function useEdges(ref: RefObject<HTMLElement | null>, dep: unknown): void {
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const f = (): void => {
      box.classList.toggle('more-l', box.scrollLeft > 2);
      box.classList.toggle('more-r', box.scrollLeft + box.clientWidth < box.scrollWidth - 2);
    };
    f();
    box.addEventListener('scroll', f, { passive: true });
    const ro = new ResizeObserver(f);
    ro.observe(box);
    return () => {
      box.removeEventListener('scroll', f);
      ro.disconnect();
    };
  }, [ref, dep]);
}

function Picker({ branches, notFound, want, orgName }: { branches: Branch[]; notFound: boolean; want: string; orgName: string }) {
  return (
    <div className="state">
      <h2>{notFound ? 'Cabang tidak ditemukan' : branches.length ? 'Pilih cabang' : 'Menu belum tersedia'}</h2>
      <p>
        {notFound
          ? `Kode cabang "${want}" tidak dikenal. Silakan pilih cabang di bawah.`
          : branches.length
            ? 'Harga dan ketersediaan menu bisa berbeda di tiap cabang.'
            : `Silakan tanyakan menu kepada kasir ${orgName}.`}
      </p>
      <div className="picks">
        {branches.map((b) => (
          <a key={b.code} href={`?cabang=${encodeURIComponent(b.code)}`}>
            <b>{b.name}</b>
            {b.address && <span>{b.address}</span>}
          </a>
        ))}
      </div>
    </div>
  );
}

export function DaftarMenu() {
  const params = useSearchParams();
  const want = (params.get('cabang') ?? '').trim().toUpperCase().slice(0, 8);
  const br = useBranches();
  const { data: cfg } = useConfig();
  const orgName = cfg?.org.name || 'Robucca';
  const all = br.data ?? [];
  const b = (want ? all.find((x) => x.code === want) : all.length === 1 ? all[0] : undefined) ?? null;
  const notFound = !!want && !!br.data && !b;
  const m = useRemote<Menu>(b ? menuKey(b.code) : null, () => api.menu(b!.code), { persist: true, maxAge: 30_000, poll: REFRESH_MS });
  const menu = m.data && b && m.data.branch.code === b.code ? m.data : undefined;
  const groups = useMemo(() => (menu ? groupsOf(menu) : []), [menu]);
  useTick(60_000); // status buka/tutup

  const [active, setActive] = useState<{ g: string; c: string }>({ g: '', c: '' });
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [lift, setLift] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLElement>(null);
  const chipsRef = useRef<HTMLElement>(null);
  const qRef = useRef<HTMLInputElement>(null);
  const lock = useRef(0);
  const jumped = useRef(false);

  useEffect(() => {
    document.title = b ? `Menu ${orgName} ${b.name}` : `Menu ${orgName}`;
  }, [b, orgName]);

  // Tinggi bilah navigasi lengket → --bar-h (jarak gulir ke judul bagian).
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`));
    ro.observe(bar);
    return () => ro.disconnect();
  }, [menu]);

  useEdges(tabsRef, groups);
  useEdges(chipsRef, active.g);

  // Geser tab/chip aktif agar terlihat penuh, di luar tepi yang dipudarkan.
  useEffect(() => {
    const box = tabsRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-g="${active.g}"]`);
    if (box && el) box.scrollTo({ left: Math.max(0, el.offsetLeft - 48), behavior: smooth() });
  }, [active.g]);
  useEffect(() => {
    const box = chipsRef.current;
    const el = box ? [...box.querySelectorAll<HTMLElement>('.chip')].find((x) => x.dataset.c === active.c) : undefined;
    if (box && el) box.scrollTo({ left: Math.max(0, el.offsetLeft - 48), behavior: smooth() });
  }, [active.c, active.g]);

  // Sorotan saat menggulir: kategori aktif = kategori pertama yang masih terlihat di bawah bilah navigasi.
  const spy = useCallback(
    (force: boolean) => {
      const bar = barRef.current;
      if (bar) setLift(bar.getBoundingClientRect().top <= 0 && scrollY > 0);
      if (q || (!force && Date.now() < lock.current)) return;
      const cats = [...document.querySelectorAll<HTMLElement>('#list .cat')];
      if (!cats.length) return;
      const line = (bar?.offsetHeight ?? 0) + 16;
      let cur = cats[cats.length - 1]!;
      if (innerHeight + scrollY < document.documentElement.scrollHeight - 4) cur = cats.find((s) => s.getBoundingClientRect().bottom > line) ?? cur;
      const g = cur.dataset.g ?? '';
      const c = cur.dataset.c ?? '';
      setActive((a) => (a.g === g && a.c === c ? a : { g, c }));
    },
    [q],
  );

  useEffect(() => {
    if (!groups.length) return;
    let raf = 0;
    const onScroll = (): void => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          spy(false);
        });
    };
    const onEnd = (): void => {
      lock.current = 0;
      spy(true);
    };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('scrollend', onEnd);
    spy(true);
    return () => {
      removeEventListener('scroll', onScroll);
      removeEventListener('scrollend', onEnd);
      cancelAnimationFrame(raf);
    };
  }, [groups, spy]);

  const closeSearch = useCallback(() => {
    setQ('');
    setSearching(false);
    if (qRef.current) qRef.current.value = '';
  }, []);

  const go = useCallback(
    (id: string, behavior: ScrollBehavior = smooth()) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (q || searching) closeSearch();
      const first = el.classList.contains('grp') ? el.querySelector<HTMLElement>('.cat') : el;
      if (first) setActive({ g: first.dataset.g ?? '', c: first.dataset.c ?? '' });
      lock.current = Date.now() + 1200;
      // Tunggu daftar tampil lagi bila baru keluar dari pencarian.
      requestAnimationFrame(() => el.scrollIntoView({ behavior, block: 'start' }));
      history.replaceState(history.state, '', `${location.pathname}${location.search}#${id}`);
    },
    [q, searching, closeSearch],
  );

  // Tautan langsung ke bagian (#g-DRINKS / #c-coffee) saat menu pertama kali tampil.
  useEffect(() => {
    if (!groups.length || jumped.current) return;
    jumped.current = true;
    const h = decodeURIComponent(location.hash.slice(1));
    if (h && document.getElementById(h)) go(h, 'auto');
  }, [groups, go]);

  const openSearch = (): void => {
    setSearching(true);
    const top = topRef.current?.offsetHeight ?? 0;
    if (scrollY > top) scrollTo(0, top);
    qRef.current?.focus();
  };

  const hits = useMemo(() => {
    if (!q) return [];
    const s = norm(q);
    const out: [Product, string][] = [];
    for (const g of groups) for (const c of g.cats) for (const p of c.items) if (norm(p.name).includes(s) || norm(c.name).includes(s)) out.push([p, c.name]);
    return out;
  }, [q, groups]);

  // --- tampilan ---
  const loadingAll = (!br.data && !br.error) || (b && !menu && !m.error);
  const failed = !loadingAll && ((!br.data && br.error) || (b && !menu && m.error));
  const open = b && b.openTime && b.closeTime ? isOpen(b) : null;
  const tz = b ? tzLabel(b.timezone) : '';
  const activeGroup = groups.find((g) => g.id === active.g);

  return (
    <>
      <header className="top" ref={topRef}>
        <div className="wrap">
          <div className="brand">
            <img src={asset('assets/brand/wordmark-dark.png')} alt={orgName} width={80} height={40} />
          </div>
          <div className="where">
            <div>
              <h1>
                <small>MENU</small>
                {b?.name || orgName}
              </h1>
              {b && open != null && (
                <div className={`status ${open ? '' : 'closed'}`}>
                  <i aria-hidden="true" />
                  {open ? `Buka · tutup pukul ${dot(b.closeTime)}` : `Sedang tutup · buka pukul ${dot(b.openTime)}`}
                </div>
              )}
            </div>
            {b && all.length > 1 && (
              <a className="change" href="./">
                Ganti cabang
              </a>
            )}
          </div>
        </div>
      </header>

      <div className={`bar${lift ? ' lift' : ''}${searching ? ' searching' : ''}`} ref={barRef} hidden={!groups.length}>
        <div className="wrap">
          <div className="row1">
            <nav className="tabs" ref={tabsRef} aria-label="Kelompok menu">
              {groups.map((g) => (
                <a
                  key={g.id}
                  className="tab"
                  href={`#g-${g.id}`}
                  data-g={g.id}
                  aria-current={active.g === g.id ? 'true' : 'false'}
                  onClick={(e) => {
                    e.preventDefault();
                    go(`g-${g.id}`);
                  }}
                >
                  {g.name}
                </a>
              ))}
            </nav>
            <button className="icon-btn" aria-label="Cari menu" onClick={() => (searching ? closeSearch() : openSearch())}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>
          </div>
          <nav className="chips" ref={chipsRef} aria-label="Kategori">
            {activeGroup?.cats.map((c) => (
              <a
                key={c.id}
                className={`chip${active.c === c.key ? ' on' : ''}`}
                href={`#c-${c.key}`}
                data-c={c.key}
                onClick={(e) => {
                  e.preventDefault();
                  go(`c-${c.key}`);
                }}
              >
                {c.name}
              </a>
            ))}
          </nav>
          <div className="search" role="search">
            <label className="sr-only" htmlFor="q">
              Cari menu
            </label>
            <input
              id="q"
              ref={qRef}
              type="search"
              placeholder="Cari kopi, ramen, croissant…"
              autoComplete="off"
              enterKeyHint="search"
              onChange={(e) => setQ(e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeSearch();
              }}
            />
            <button type="button" onClick={closeSearch}>
              Tutup
            </button>
          </div>
        </div>
      </div>

      <main className="wrap" id="main">
        {loadingAll ? (
          <div className="loading">
            <i />
            Memuat menu…
          </div>
        ) : failed ? (
          <div className="state">
            <h2>Menu gagal dimuat</h2>
            <p>{(b ? m.error : br.error) ?? 'Terjadi kesalahan.'}</p>
            <button className="btn" type="button" onClick={() => void (b ? m.reload() : br.reload())}>
              Muat ulang
            </button>
          </div>
        ) : !b ? (
          <Picker branches={all} notFound={notFound} want={want} orgName={orgName} />
        ) : !groups.length ? (
          <div className="state">
            <h2>Menu belum tersedia</h2>
            <p>Silakan tanyakan menu kepada kasir kami.</p>
          </div>
        ) : (
          <>
            <div id="list" hidden={!!q}>
              {groups.map((g) => {
                const n = g.cats.reduce((a, c) => a + c.items.length, 0);
                // Kelompok berisi satu kategori bernama sama (mis. Snack) tidak perlu judul kategori.
                const single = g.cats.length === 1 && norm(g.cats[0]!.name) === norm(g.name);
                return (
                  <section className="grp" id={`g-${g.id}`} key={g.id} aria-labelledby={`h-${g.id}`}>
                    <h2 id={`h-${g.id}`}>
                      {g.name} <small>{n} menu</small>
                    </h2>
                    {g.cats.map((c) => {
                      const allSig = c.items.every((i) => i.isSignature);
                      return (
                        <section className="cat" id={`c-${c.key}`} key={c.id} data-g={g.id} data-c={c.key}>
                          {!single && (
                            <h3>
                              {c.name}
                              {allSig && <span className="sig">★ Signature</span>}
                            </h3>
                          )}
                          <div className="items">
                            {c.items.map((p) => (
                              <Item key={p.id} p={p} star={!allSig} />
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </section>
                );
              })}
            </div>
            {q && (
              <div id="results">
                {hits.length ? (
                  <>
                    <p className="where-cat" style={{ margin: '14px 0 0' }} role="status">
                      {hits.length} menu ditemukan
                    </p>
                    <div className="items">
                      {hits.map(([p, cat]) => (
                        <Item key={p.id} p={p} cat={cat} />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="state" role="status">
                    <h2>Tidak ditemukan</h2>
                    <p>Coba kata lain, mis. &quot;latte&quot;, &quot;ramen&quot;, atau &quot;croissant&quot;.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {b && menu && (
        <footer className="foot wrap">
          {m.error && <p className="note">Harga & ketersediaan belum bisa diperbarui, yang tampil data terakhir.</p>}
          <p className="note">{priceNote(menu)}</p>
          <p>
            {orgName} {b.name}
            {b.address ? ` · ${b.address}` : ''}
          </p>
          {b.openTime && b.closeTime && (
            <p>
              Jam buka {dot(b.openTime)}–{dot(b.closeTime)} {tz}
              {b.phone ? ` · ${b.phone}` : ''}
            </p>
          )}
          {cfg?.org.instagram && <p>{handleOf(cfg.org.instagram)}</p>}
          {m.at > 0 && (
            <p className="src">
              Harga & ketersediaan langsung dari kasir cabang · diperbarui {at(m.at, b.timezone).clock} {tz}
            </p>
          )}
        </footer>
      )}
    </>
  );
}
