'use client';
/* Tempat lembar bawah dirender + lembar konfirmasi umum. Geser ke bawah untuk menutup (port enableDrag). */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { closeSheet, openSheet, useSheets, type SheetEntry } from '@/lib/sheets';

function Frame({ e }: { e: SheetEntry }) {
  const sh = useRef<HTMLDivElement>(null);
  const bd = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, []);

  useEffect(() => {
    const s = sh.current;
    const b = bd.current;
    if (!s || !b) return;
    // iOS: cegah halaman di belakang ikut tergulir.
    const stopBd = (ev: TouchEvent): void => {
      if (ev.cancelable) ev.preventDefault();
    };
    const stopSh = (ev: TouchEvent): void => {
      if ((ev.target as Element).closest('.sheet-body, .hscroll, textarea')) return;
      if (ev.cancelable) ev.preventDefault();
    };
    let y0: number | null = null;
    let dy = 0;
    let t0 = 0;
    let active = false;
    const start = (ev: TouchEvent): void => {
      const t = ev.target as Element;
      const body = s.querySelector('.sheet-body');
      const onHandle = !!t.closest('.sheet-handle');
      if (!onHandle && (t.closest('input, textarea, .hscroll, iframe') || (body && body.scrollTop > 2))) {
        y0 = null;
        return;
      }
      y0 = ev.touches[0]!.clientY;
      dy = 0;
      t0 = Date.now();
      active = false;
    };
    const move = (ev: TouchEvent): void => {
      if (y0 == null) return;
      dy = ev.touches[0]!.clientY - y0;
      if (!active && dy > 8) {
        active = true;
        s.classList.add('drag');
      }
      if (active) {
        if (ev.cancelable) ev.preventDefault();
        s.style.transform = `translate(-50%, ${Math.max(0, dy)}px)`;
      }
    };
    const end = (): void => {
      if (!active) {
        y0 = null;
        return;
      }
      s.classList.remove('drag');
      const v = dy / Math.max(1, Date.now() - t0);
      if (dy > 120 || v > 0.6) closeSheet();
      else s.style.transform = '';
      y0 = null;
      active = false;
    };
    b.addEventListener('touchmove', stopBd, { passive: false });
    s.addEventListener('touchmove', stopSh, { passive: false });
    s.addEventListener('touchstart', start, { passive: true });
    s.addEventListener('touchmove', move, { passive: false });
    s.addEventListener('touchend', end);
    return () => {
      b.removeEventListener('touchmove', stopBd);
      s.removeEventListener('touchmove', stopSh);
      s.removeEventListener('touchstart', start);
      s.removeEventListener('touchmove', move);
      s.removeEventListener('touchend', end);
    };
  }, []);

  useEffect(() => {
    if (e.closing && sh.current) sh.current.style.transform = '';
  }, [e.closing]);

  const on = shown && !e.closing;
  return (
    <>
      <div ref={bd} className={`backdrop ${on ? 'in' : ''}`} onClick={() => !e.closing && closeSheet()} />
      <div ref={sh} className={`sheet ${e.opts.full ? 'full' : ''} ${on ? 'in' : ''}`} role="dialog" aria-modal="true" inert={e.closing || undefined}>
        <div className={`sheet-handle ${e.opts.handleOnImg ? 'on-img' : ''}`} />
        {e.node}
      </div>
    </>
  );
}

export function SheetHost() {
  const list = useSheets();
  return (
    <div id="sheets">
      {list.map((e) => (
        <Frame key={e.id} e={e} />
      ))}
    </div>
  );
}

// --- Konfirmasi ----------------------------------------------------------------------

function Confirm({ title, text, ok, danger, onOk }: { title: string; text: ReactNode; ok: string; danger?: boolean; onOk: () => void }) {
  return (
    <>
      <div className="sheet-body">
        <div className="sheet-head">
          <h2>{title}</h2>
          <p>{text}</p>
        </div>
      </div>
      <div className="sheet-foot">
        <button className="btn soft grow" onClick={() => closeSheet()}>
          Batal
        </button>
        <button className="btn grow" style={danger ? { background: 'var(--danger)' } : undefined} onClick={() => closeSheet(onOk)}>
          {ok}
        </button>
      </div>
    </>
  );
}

export function confirmSheet(o: { title: string; text: ReactNode; ok: string; danger?: boolean; onOk: () => void }): void {
  openSheet(<Confirm {...o} />);
}
