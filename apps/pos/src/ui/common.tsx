/* Komponen kecil bersama: avatar staf, foto menu, papan angka, papan PIN, input Rupiah. */
import { useEffect, useState, type ReactNode } from 'react';
import { staffColor } from '../data/master';
import { Icon } from '../lib/icons';

export const initials = (name: string | null | undefined): string =>
  String(name || '?')
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase() || '?';

export function Avatar({ staff, size = '' }: { staff: { id: string; name: string } | null | undefined; size?: 'sm' | 'lg' | '' }) {
  return (
    <span className={`avatar ${size}`} style={{ background: staff ? staffColor(staff.id) : '#01512C' }} aria-hidden="true">
      {initials(staff?.name)}
    </span>
  );
}

/** Foto menu: tampil halus saat termuat, hilang bila gagal (sama dengan hydrateImgs lama). */
export function FadeImg({ src, alt = '' }: { src: string | null | undefined; alt?: string }) {
  const [state, setState] = useState<'load' | 'ok' | 'err'>('load');
  useEffect(() => setState('load'), [src]);
  if (!src || state === 'err') return null;
  return (
    <img
      data-fade
      className={state === 'ok' ? 'ok' : ''}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => setState('ok')}
      onError={() => setState('err')}
    />
  );
}

/* ---------- papan angka nominal ---------- */
/** Terapkan tombol ke nilai (string digit) → nilai baru */
export function npKey(val: string, k: string, max = 12): string {
  let v = String(val || '');
  if (k === 'del') v = v.slice(0, -1);
  else if (k === 'clr') v = '';
  else if (/^\d+$/.test(k)) v = (v + k).replace(/^0+(?=\d)/, '');
  if (v.length > max) v = v.slice(0, max);
  return v;
}

/** Tombol fisik keyboard → kunci numpad */
export function keyToNp(e: KeyboardEvent): string | null {
  if (/^\d$/.test(e.key)) return e.key;
  if (e.key === 'Backspace') return 'del';
  if (e.key === 'Delete') return 'clr';
  return null;
}

export function Numpad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <div className="numpad" role="group" aria-label="Papan angka">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'].map((d) => (
        <button type="button" key={d} data-np={d} onClick={() => onKey(d)}>
          {d}
        </button>
      ))}
      <button type="button" className="fn" data-np="del" aria-label="Hapus" onClick={() => onKey('del')}>
        <Icon name="chevron-left" />
      </button>
      <button type="button" className="fn" data-np="clr" style={{ gridColumn: 'span 3', height: 42 }} onClick={() => onKey('clr')}>
        Hapus semua
      </button>
    </div>
  );
}

/** Dengarkan keyboard fisik selama komponen terpasang (abaikan saat mengetik di input). */
export function useKeys(fn: (e: KeyboardEvent) => void, deps: unknown[] = []): void {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      fn(e);
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/* ---------- papan PIN (login & persetujuan manajer) ---------- */
export function PinPad({
  who,
  pin,
  msg,
  shake = false,
  onKey,
  top,
  gap,
}: {
  who: ReactNode;
  pin: string;
  msg: string;
  shake?: boolean;
  onKey: (k: string) => void;
  top?: ReactNode;
  gap?: number;
}) {
  const len = Math.min(6, Math.max(4, pin.length));
  return (
    <div className="pin-box" style={gap ? { gap } : undefined}>
      {top}
      {who}
      <div className={`pin-dots ${shake ? 'shake' : ''}`} aria-label={`PIN ${pin.length} digit`}>
        {Array.from({ length: len }, (_, i) => (
          <i key={i} className={i < pin.length ? 'on' : ''} />
        ))}
      </div>
      <div className="pin-msg" role="alert">
        {msg}
      </div>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} data-k={d} onClick={() => onKey(d)}>
            {d}
          </button>
        ))}
        <button className="fn" data-k="del" aria-label="Hapus" onClick={() => onKey('del')}>
          <Icon name="chevron-left" />
        </button>
        <button data-k="0" onClick={() => onKey('0')}>
          0
        </button>
        <button className="fn" data-k="ok" aria-label="OK" onClick={() => onKey('ok')}>
          <Icon name="check" />
        </button>
      </div>
    </div>
  );
}

/** Input nominal Rupiah dengan pemisah ribuan saat mengetik. */
export function MoneyInput({ value, onChange, ...rest }: { value: number; onChange: (n: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const fmt = (n: number) => (n ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '');
  return (
    <input
      {...rest}
      inputMode="numeric"
      value={fmt(value)}
      onChange={(e) => {
        const d = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
        onChange(d ? parseInt(d.slice(0, 12), 10) : 0);
      }}
    />
  );
}

export function Empty({ icon, title, children }: { icon: Parameters<typeof Icon>[0]['name']; title?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="em-ico">
        <Icon name={icon} size="lg" />
      </div>
      {title ? <h3>{title}</h3> : null}
      {children}
    </div>
  );
}
