/* =========================================================
   Lapisan atas: modal, drawer, toast, layar sibuk, konfirmasi, isian teks.
   Port dari pos/js/lib/ui.js. API imperatif (Promise) supaya alur kasir tetap
   sederhana: `const ok = await confirmBox(...)`. Dipakai juga oleh modul kantor.
   ========================================================= */
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../lib/icons';

/* ---------- toko kecil untuk lapisan ---------- */
interface Layer {
  id: number;
  node: ReactNode;
  dismissable: boolean;
  close: (v?: unknown) => void;
}
interface ToastItem {
  id: number;
  msg: string;
  type: 'ok' | 'warn' | 'err';
  out: boolean;
}

let layers: Layer[] = [];
let toasts: ToastItem[] = [];
let busyText: string | null = null;
let seq = 0;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
let snap: { layers: Layer[]; toasts: ToastItem[]; busyText: string | null } = { layers, toasts, busyText };
const snapshot = () => snap;
const commit = () => {
  snap = { layers, toasts, busyText };
  notify();
};

export type Close<T> = (v?: T) => void;

/**
 * Buka lapisan (modal/drawer). `render(close)` mengembalikan elemen; Promise selesai saat ditutup
 * (nilai `close(v)`, atau undefined bila dibatalkan).
 */
export function openLayer<T = unknown>(render: (close: Close<T>) => ReactNode, { dismissable = true } = {}): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const id = ++seq;
    const prevFocus = document.activeElement as HTMLElement | null;
    let closed = false;
    const close = (v?: unknown) => {
      if (closed) return;
      closed = true;
      layers = layers.filter((l) => l.id !== id);
      commit();
      resolve(v as T | undefined);
      if (prevFocus?.focus && document.contains(prevFocus)) {
        try {
          prevFocus.focus({ preventScroll: true });
        } catch {
          /* noop */
        }
      }
    };
    layers = [...layers, { id, node: render(close as Close<T>), dismissable, close }];
    commit();
  });
}

export const modalOpen = (): boolean => layers.length > 0;
export function closeAllModals(): void {
  [...layers].reverse().forEach((l) => l.close(undefined));
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !layers.length) return;
  const top = layers[layers.length - 1]!;
  if (top.dismissable) {
    e.preventDefault();
    top.close(undefined);
  }
});

/* ---------- toast ---------- */
export function toast(msg: string, type: 'ok' | 'warn' | 'err' = 'ok', ms = 2600): void {
  const id = ++seq;
  toasts = [...toasts, { id, msg, type, out: false }].slice(-3);
  commit();
  setTimeout(() => {
    toasts = toasts.map((t) => (t.id === id ? { ...t, out: true } : t));
    commit();
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
      commit();
    }, 300);
  }, ms);
}

/* ---------- layar sibuk ---------- */
export function busy(text = 'Memproses…'): { set: (t: string) => void; done: () => void } {
  busyText = text;
  commit();
  return {
    set: (t) => {
      busyText = t;
      commit();
    },
    done: () => {
      busyText = null;
      commit();
    },
  };
}

/** Tempat semua lapisan digambar (sekali di akar aplikasi). */
export function OverlayHost() {
  const s = useSyncExternalStore(subscribe, snapshot);
  return createPortal(
    <>
      {s.layers.map((l) => (
        <LayerCtx key={l.id} layer={l} />
      ))}
      {s.toasts.length > 0 && (
        <div className="toasts" role="status" aria-live="polite">
          {s.toasts.map((t) => (
            <div key={t.id} className={`toast ${t.type === 'ok' ? '' : t.type} ${t.out ? 'out' : ''}`}>
              <Icon name={t.type === 'err' ? 'alert' : t.type === 'warn' ? 'info' : 'check-circle'} size="sm" />
              <span>{t.msg}</span>
            </div>
          ))}
        </div>
      )}
      {s.busyText != null && (
        <div className="busy">
          <div className="bx">
            <div className="spinner" />
            <span>{s.busyText}</span>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}

function LayerCtx({ layer }: { layer: Layer }) {
  return <LayerContext.Provider value={layer}>{layer.node}</LayerContext.Provider>;
}
const LayerContext = createContext<Layer | null>(null);
/** Tutup lapisan tempat komponen ini berada. */
export const useLayerClose = (): ((v?: unknown) => void) => {
  const l = useContext(LayerContext);
  return l ? l.close : () => {};
};

/** Kelas `in` ditambahkan setelah dipasang agar animasi CSS lama jalan. */
function useIn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(r);
  }, []);
  return on;
}

/* ---------- Modal ---------- */
export interface ModalProps {
  title?: string;
  sub?: ReactNode;
  size?: 'sm' | 'lg' | 'xl' | '';
  foot?: ReactNode;
  children?: ReactNode;
  /** false = tidak bisa ditutup dengan Esc/klik latar */
  dismissable?: boolean;
  className?: string;
}

export function Modal({ title, sub, size = '', foot, children, dismissable = true, className = '' }: ModalProps) {
  const close = useLayerClose();
  const on = useIn();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = ref.current?.querySelector<HTMLElement>('[autofocus]');
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 60);
  }, []);
  return (
    <div
      className={`modal-bd ${on ? 'in' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && dismissable) close(undefined);
      }}
    >
      <div ref={ref} className={`modal ${size} ${className}`} role="dialog" aria-modal="true" aria-label={title ?? ''}>
        {title && (
          <div className="modal-head">
            <div className="grow">
              <h2>{title}</h2>
              {sub ? <p>{sub}</p> : null}
            </div>
            {dismissable && (
              <button className="icon-btn" onClick={() => close(undefined)} aria-label="Tutup">
                <Icon name="x" />
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {foot ? <div className="modal-foot">{foot}</div> : null}
      </div>
    </div>
  );
}

/* ---------- Drawer (panel kanan) ---------- */
export function Drawer({ title, sub, foot, children, wide = false }: { title: string; sub?: ReactNode; foot?: ReactNode; children?: ReactNode; wide?: boolean }) {
  const close = useLayerClose();
  const on = useIn();
  return (
    <>
      <div className={`drawer-bd ${on ? 'in' : ''}`} onClick={() => close(undefined)} />
      <aside className={`drawer ${wide ? 'wide' : ''} ${on ? 'in' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="grow">
            <h2>{title}</h2>
            {sub ? <p>{sub}</p> : null}
          </div>
          <button className="icon-btn" onClick={() => close(undefined)} aria-label="Tutup">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body" style={{ flex: 1 }}>
          {children}
        </div>
        {foot ? <div className="modal-foot">{foot}</div> : null}
      </aside>
    </>
  );
}

/* ---------- konfirmasi & isian ---------- */
export function confirmBox({ title, text = '', ok = 'Ya', cancel = 'Batal', danger = false }: { title: string; text?: ReactNode; ok?: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  return openLayer<boolean>((close) => (
    <Modal
      title={title}
      size="sm"
      foot={
        <>
          <button className="btn ghost" onClick={() => close(false)}>
            {cancel}
          </button>
          <button className={`btn ${danger ? 'danger' : ''}`} onClick={() => close(true)} data-ok>
            {ok}
          </button>
        </>
      }
    >
      {text ? <p style={{ margin: 0, color: 'var(--ink-2)' }}>{text}</p> : null}
    </Modal>
  )).then((v) => v === true);
}

export interface PromptOpts {
  title: string;
  text?: ReactNode;
  label?: string;
  placeholder?: string;
  value?: string;
  ok?: string;
  danger?: boolean;
  presets?: string[];
  required?: boolean;
  type?: string;
  minLength?: number;
}

function PromptBody({ o, close }: { o: PromptOpts; close: Close<string> }) {
  const [v, setV] = useState(o.value ?? '');
  const [err, setErr] = useState('');
  const inp = useRef<HTMLInputElement>(null);
  const submit = () => {
    const t = v.trim();
    if ((o.required ?? true) && !t) return setErr('Wajib diisi.');
    if (o.minLength && t.length < o.minLength) return setErr(`Minimal ${o.minLength} karakter.`);
    close(t);
  };
  return (
    <Modal
      title={o.title}
      size="sm"
      foot={
        <>
          <button className="btn ghost" onClick={() => close(undefined)}>
            Batal
          </button>
          <button className={`btn ${o.danger ? 'danger' : ''}`} onClick={submit} data-ok>
            {o.ok ?? 'Simpan'}
          </button>
        </>
      }
    >
      {o.text ? <p style={{ margin: '0 0 12px', color: 'var(--ink-2)' }}>{o.text}</p> : null}
      <label className="field">
        {o.label ? <span>{o.label}</span> : null}
        <input
          ref={inp}
          className={`input ${err ? 'err' : ''}`}
          type={o.type ?? 'text'}
          placeholder={o.placeholder ?? ''}
          value={v}
          autoFocus
          autoComplete="off"
          data-in
          onChange={(e) => {
            setV(e.target.value);
            setErr('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </label>
      {o.presets?.length ? (
        <div className="quick-notes">
          {o.presets.map((p) => (
            <button
              key={p}
              className="chip sm"
              data-p={p}
              onClick={() => {
                setV(p);
                setErr('');
                inp.current?.focus();
              }}
            >
              {p}
            </button>
          ))}
        </div>
      ) : null}
      {err ? <p className="err-text">{err}</p> : null}
    </Modal>
  );
}

/** Minta teks (mis. alasan void). presets = pilihan cepat. */
export function promptBox(o: PromptOpts): Promise<string | null> {
  return openLayer<string>((close) => <PromptBody o={o} close={close} />).then((v) => (typeof v === 'string' ? v : null));
}

/* ---------- unduh berkas ---------- */
export function download(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([mime.startsWith('text/csv') ? '﻿' + text : text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/* ---------- bunyi pendek (dapur) ---------- */
let actx: AudioContext | null = null;
export function beep(times = 2): boolean {
  try {
    actx = actx ?? new AudioContext();
    if (actx.state === 'suspended') void actx.resume();
    for (let i = 0; i < times; i++) {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      const t0 = actx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(g).connect(actx.destination);
      o.start(t0);
      o.stop(t0 + 0.2);
    }
    return true;
  } catch {
    return false;
  }
}
export const audioReady = (): boolean => !!actx && actx.state === 'running';
