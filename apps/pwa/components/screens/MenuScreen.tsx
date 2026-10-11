'use client';
/* Menu cabang: Pick Up / Delivery, cari, chip kategori dengan scroll spy, kelompok & kategori, rute delivery.
   Port Menu prototipe; menu, harga, dan stok langsung dari kasir cabang. */
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { ItemRow, qtyMap } from '@/components/MenuParts';
import { RouteCard } from '@/components/RouteCard';
import { openBranchPicker } from '@/components/sheets/BranchSheet';
import { openSearch } from '@/components/sheets/SearchSheet';
import { setMode } from '@/lib/cart';
import { GROUPS } from '@/lib/content';
import { useBranch, useCouriers, useMenu } from '@/lib/data';
import { catKey, priceNote } from '@/lib/menu';
import { canDeliver } from '@/lib/places';
import { haptic } from '@/lib/platform';
import { setState, useApp, type Mode } from '@/lib/store';
import { at, dateShort, dot } from '@/lib/time';
import type { Branch } from '@/lib/types';
import { toast } from '@/lib/ui';

/** Ganti tipe pesanan dari tombol Pick Up / Delivery. */
export function pickMode(m: Mode, b: Branch | null): void {
  if (m === 'delivery' && b && !canDeliver(b)) {
    toast(`Delivery belum tersedia di ${b.name}`, 'info');
    return;
  }
  if (setMode(m)) toast('Pre-order dibatalkan', 'info');
  haptic();
}

export function ModeSeg({ b }: { b: Branch | null }) {
  const s = useApp();
  const pre = s.preRsv && s.preRsv.branch === s.branch;
  const v = pre ? 'preorder' : s.mode === 'delivery' && b && !canDeliver(b) ? 'pickup' : s.mode;
  const btn = (m: Mode, ic: string, label: string) => (
    <button role="tab" aria-selected={v === m} className={v === m ? 'on' : undefined} onClick={() => pickMode(m, b)}>
      <Icon n={ic} cls="sm" /> {label}
    </button>
  );
  return (
    <div className="seg" data-v={v} role="tablist" aria-label="Tipe pesanan">
      {btn('pickup', 'bag', 'Pick Up')}
      {btn('delivery', 'scooter', 'Delivery')}
    </div>
  );
}

function Ctx({ b }: { b: Branch }) {
  const s = useApp();
  const { data: couriers } = useCouriers();
  const pre = s.preRsv && s.preRsv.branch === s.branch ? s.preRsv : null;
  if (pre) {
    const w = at(pre.reservedFor, b.timezone);
    return (
      <>
        <Icon n="calendar" cls="xs" />
        <span>
          Pre-order reservasi{' '}
          <b>
            {dateShort(w.ymd)}, {dot(w.time)}
          </b>
        </span>
        <button
          className="edit"
          onClick={() => {
            setState({ preRsv: null });
            toast('Pre-order dibatalkan', 'info');
          }}
        >
          Batal
        </button>
      </>
    );
  }
  if (s.mode === 'delivery' && canDeliver(b)) {
    const names = couriers?.length ? couriers.map((c) => c.name.replace(/\s+Instant$/i, '')).join(' / ') : 'GoSend / GrabExpress';
    return (
      <>
        <Icon n="scooter" cls="xs" />
        <span>
          Diantar <b>{names}</b>
          {b.deliveryMaxKm != null ? ` · maks. ${b.deliveryMaxKm} km` : ''}
        </span>
      </>
    );
  }
  return (
    <>
      <Icon n="bag" cls="xs" />
      <span>
        Ambil di <b>Robucca {b.name}</b>, tanpa antre
      </span>
    </>
  );
}

export function MenuScreen() {
  const s = useApp();
  const q = useSearchParams();
  const { branch: b, loading: bLoading } = useBranch();
  const { menu, idx, error, reload } = useMenu(b?.code);
  const qty = useMemo(() => qtyMap(s.cart), [s.cart]);
  const head = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const ctl = useRef<{ scrollTo: (id: string, smooth?: boolean) => void } | null>(null);
  const pre = s.preRsv && s.preRsv.branch === s.branch;
  const delivery = s.mode === 'delivery' && !pre && canDeliver(b);

  // Scroll spy: chip kategori aktif mengikuti posisi gulir.
  useEffect(() => {
    const h = head.current;
    const c = chips.current;
    const bd = body.current;
    if (!menu || !h || !c || !bd) return;
    const secs = [...bd.querySelectorAll<HTMLElement>('.cat-sec')];
    if (!secs.length) return;
    let active = '';
    let lock = 0;
    let raf = 0;
    let idleT: ReturnType<typeof setTimeout> | undefined;
    const setActive = (id: string): void => {
      active = id;
      c.querySelectorAll<HTMLElement>('.chip').forEach((x) => x.classList.toggle('on', x.dataset.cat === id));
      const on = c.querySelector<HTMLElement>(`[data-cat="${CSS.escape(id)}"]`);
      if (on) c.scrollTo({ left: on.offsetLeft - 16, behavior: 'smooth' });
    };
    const spy = (): void => {
      raf = 0;
      h.classList.toggle('shadow', scrollY > 4);
      if (Date.now() < lock) return;
      const line = h.offsetHeight + 24;
      let cur = secs[0]!.dataset.cat!;
      for (const sec of secs) {
        if (sec.getBoundingClientRect().top <= line) cur = sec.dataset.cat!;
        else break;
      }
      if (cur !== active) setActive(cur);
    };
    const onEnd = (): void => {
      if (lock) {
        lock = 0;
        spy();
      }
    };
    const onScroll = (): void => {
      if (lock) {
        clearTimeout(idleT);
        idleT = setTimeout(onEnd, 160);
      }
      if (!raf) raf = requestAnimationFrame(spy);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', onEnd);
    ctl.current = {
      scrollTo(id, smooth = true) {
        const sec = bd.querySelector<HTMLElement>(`#cat-${CSS.escape(id)}`);
        if (!sec) return;
        lock = Date.now() + (smooth ? 1800 : 150);
        setActive(id);
        const top = sec.getBoundingClientRect().top + scrollY - h.offsetHeight - 4;
        window.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
      },
    };
    spy();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('scrollend', onEnd);
      cancelAnimationFrame(raf);
      clearTimeout(idleT);
      ctl.current = null;
    };
  }, [menu, delivery]);

  // ?cat=coffee: langsung ke kategori (sekali per kunjungan).
  const cat = q.get('cat');
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    if (!menu || !cat || jumped.current === cat) return;
    jumped.current = cat;
    const target = idx?.bySlug.get(cat) ?? idx?.byId.get(cat);
    if (target) requestAnimationFrame(() => ctl.current?.scrollTo(catKey(target), false));
  }, [menu, idx, cat]);

  const onChip = useCallback((key: string) => ctl.current?.scrollTo(key), []);

  if (!b) {
    return (
      <div className="screen">
        <div className="empty" style={{ paddingTop: 90 }}>
          <div className="em-ico">
            <Icon n="store" cls="lg" />
          </div>
          <h3>{bLoading ? 'Memuat cabang…' : 'Pilih cabang dulu'}</h3>
          <p>Menu, harga, dan stok mengikuti cabang Robucca yang kamu pilih.</p>
          {!bLoading && (
            <button className="btn" onClick={() => openBranchPicker()}>
              Pilih cabang
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="menu-head" id="mh" ref={head}>
        <div className="mh-row">
          <ModeSeg b={b} />
          <button className="icon-btn" onClick={() => openSearch()} aria-label="Cari menu">
            <Icon n="search" />
          </button>
        </div>
        <div className="ctx">
          <Ctx b={b} />
        </div>
        <div className="hscroll cat-chips" ref={chips}>
          {menu?.categories.map((c, i) => (
            <button key={c.id} className={`chip sm ${i ? '' : 'on'}`} data-cat={catKey(c)} onClick={() => onChip(catKey(c))}>
              {c.isSignature ? '★ ' : ''}
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <div className="menu-body" ref={body}>
        {delivery && (
          <div id="route-slot">
            <RouteCard compact onPickup={() => pickMode('pickup', b)} />
          </div>
        )}
        {!menu && error && (
          <div className="empty">
            <h3>Menu belum bisa dimuat</h3>
            <p>{error}</p>
            <button className="btn" onClick={() => void reload()}>
              Coba lagi
            </button>
          </div>
        )}
        {!menu && !error && (
          <div style={{ paddingTop: 22 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skel" style={{ height: 96, marginTop: 14 }} />
            ))}
          </div>
        )}
        {menu &&
          GROUPS.map((g) => {
            const cats = menu.categories.filter((c) => c.group === g.id);
            if (!cats.length) return null;
            return (
              <div key={g.id}>
                <div className="grp-h">
                  <span>{g.name}</span>
                </div>
                {cats.map((c) => (
                  <section key={c.id} className="cat-sec" id={`cat-${catKey(c)}`} data-cat={catKey(c)}>
                    <h2>
                      {c.name}
                      {c.isSignature && (
                        <>
                          {' '}
                          <span className="tag dark">★ Signature</span>
                        </>
                      )}
                    </h2>
                    {c.description && <p>{c.description}</p>}
                    {c.products.map((p) => (
                      <ItemRow key={p.id} p={p} n={qty.get(p.id) ?? 0} />
                    ))}
                  </section>
                ))}
              </div>
            );
          })}
        {menu && (
          <p className="faint" style={{ fontSize: 12, textAlign: 'center', margin: '26px 0 0' }}>
            {priceNote(menu)}
          </p>
        )}
      </div>
    </div>
  );
}

