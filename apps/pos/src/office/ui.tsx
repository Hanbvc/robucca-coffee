/* Bagian bersama halaman kantor: kepala halaman, filter periode & cabang, tabel yang bisa diurutkan,
   grafik ringan (port components/charts.js POS lama), dan pemuat data dengan status galat. */
import { PRESETS, presetRange, short } from '@robucca/core';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../lib/icons';
import { activeBranches, errText, filter, me, NeedPinError, periodLabel, range, setFilter, todayStr, useFilter } from './lib';

/* =========================================================
   Kepala halaman
   ========================================================= */
export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="topbar">
      <div>
        <h1>{title}</h1>
        {sub ? <div className="crumb">{sub}</div> : null}
      </div>
      {actions ? <div className="right row wrap">{actions}</div> : null}
    </div>
  );
}

/* =========================================================
   Filter periode & cabang
   ========================================================= */
export function FilterBar({ period = true, branch = true, extra }: { period?: boolean; branch?: boolean; extra?: ReactNode }) {
  const F = useFilter();
  const mine = activeBranches();
  const all = me()?.allBranches;
  const r = range();
  return (
    <div className="filters" role="group" aria-label="Filter">
      {period && (
        <>
          {PRESETS.map(([k, l]) => (
            <button key={k} className={`chip sm ${F.preset === k ? 'on' : ''}`} data-preset={k} onClick={() => setFilter({ preset: k })}>
              {l}
            </button>
          ))}
          <button
            className={`chip sm ${F.preset === 'custom' ? 'on' : ''}`}
            data-preset="custom"
            onClick={() => {
              const d = presetRange('7d', todayStr());
              setFilter({ preset: 'custom', from: F.from || d.from, to: F.to || d.to });
            }}
          >
            <Icon name="calendar" size="xs" /> Pilih tanggal
          </button>
          {F.preset === 'custom' ? (
            <span className="custom-range">
              <input className="input" type="date" data-from value={F.from || r.from} aria-label="Dari tanggal" onChange={(e) => setFilter({ from: e.target.value })} />
              <span className="muted">–</span>
              <input className="input" type="date" data-to value={F.to || r.to} aria-label="Sampai tanggal" onChange={(e) => setFilter({ to: e.target.value })} />
            </span>
          ) : (
            <span className="range-label">{periodLabel()}</span>
          )}
        </>
      )}
      {branch && (mine.length > 1 || all) && (
        <>
          <span className="sep" />
          <select className="select sm" data-branch aria-label="Cabang" value={F.branch} onChange={(e) => setFilter({ branch: e.target.value })}>
            <option value="all">{all ? 'Semua cabang' : 'Semua cabang saya'}</option>
            {mine.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </>
      )}
      {extra}
    </div>
  );
}

/* =========================================================
   Pemuat data
   ========================================================= */
export interface Loaded<T> {
  data: T | null;
  err: unknown;
  loading: boolean;
  reload: () => void;
}
/** Muat data saat `key` berubah; respons lama yang datang terlambat diabaikan. */
export function useLoad<T>(fn: () => Promise<T>, key: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    setLoading(true);
    fn().then(
      (d) => {
        if (my !== seq.current) return;
        setData(d);
        setErr(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (my !== seq.current) return;
        console.warn('kantor', e);
        setErr(e);
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...key, tick, JSON.stringify(filter())]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, err, loading, reload };
}

/** Isi halaman: pemutar saat pertama memuat, kotak galat, atau konten (redup saat memuat ulang). */
export function Body<T>({ l, children }: { l: Loaded<T>; children: (d: T) => ReactNode }) {
  if (l.err && !(l.err instanceof NeedPinError)) {
    return (
      <div className="note red" data-err>
        <Icon name="alert" size="sm" />
        <span>
          {errText(l.err)}{' '}
          <button className="btn ghost xs" onClick={l.reload}>
            <Icon name="rotate" size="xs" /> Coba lagi
          </button>
        </span>
      </div>
    );
  }
  if (l.err instanceof NeedPinError) throw l.err; // ditangkap kerangka kantor → layar verifikasi PIN
  if (!l.data) {
    return (
      <div className="empty">
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }
  return <div className={l.loading ? 'loading' : ''}>{children(l.data)}</div>;
}

/* =========================================================
   Tabel yang bisa diurutkan
   ========================================================= */
export interface Col<T> {
  key: string;
  label: string;
  r?: boolean;
  get: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  sort?: (row: T) => string | number;
}
export function SortTable<T>({
  cols, rows, sortKey = null, desc = true, foot, onRow, rowKey, empty = 'Belum ada data untuk periode ini.',
}: {
  cols: Col<T>[];
  rows: T[];
  sortKey?: string | null;
  desc?: boolean;
  foot?: (string | number)[];
  onRow?: (row: T) => void;
  rowKey?: (row: T, i: number) => string;
  empty?: string;
}) {
  const [key, setKey] = useState<string | null>(sortKey);
  const [dsc, setDsc] = useState(desc);
  useEffect(() => {
    setKey(sortKey);
    setDsc(desc);
  }, [sortKey, desc]);
  const c = cols.find((x) => x.key === key);
  const list = c
    ? [...rows].sort((a, b) => {
        const va = c.sort ? c.sort(a) : c.get(a);
        const vb = c.sort ? c.sort(b) : c.get(b);
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'id');
        return dsc ? -cmp : cmp;
      })
    : rows;
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            {cols.map((x) => (
              <th
                key={x.key}
                className={`sort ${x.r ? 'r' : ''}`}
                data-sort={x.key}
                aria-sort={x.key === key ? (dsc ? 'descending' : 'ascending') : 'none'}
                onClick={() => {
                  if (key === x.key) setDsc(!dsc);
                  else {
                    setKey(x.key);
                    setDsc(true);
                  }
                }}
              >
                {x.label}
                {x.key === key ? (dsc ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.length ? (
            list.map((r, i) => (
              <tr key={rowKey ? rowKey(r, i) : i} className={onRow ? 'click' : ''} onClick={onRow ? () => onRow(r) : undefined}>
                {cols.map((x) => (
                  <td key={x.key} className={x.r ? 'r' : ''}>
                    {x.render ? x.render(r) : x.get(r)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={cols.length} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
        {foot && list.length ? (
          <tfoot>
            <tr>
              {foot.map((f, i) => (
                <td key={i} className={cols[i]?.r ? 'r' : ''}>
                  {f}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/* =========================================================
   Grafik (satu warna aksen + abu untuk pembanding, batang ≤24px, tooltip, tabel alternatif)
   ========================================================= */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= raw) ?? 10 * mag;
  return step * 4;
}
const barPath = (x: number, y: number, w: number, h: number, r = 4): string => {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  const y0 = y + h;
  return `M${x},${y0}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y0}Z`;
};

export interface Pt {
  label: string;
  full?: string;
  value: number;
  prev?: number;
}
export function ColumnChart({
  data, height = 230, fmt = (v: number) => String(v), curName = 'Periode ini', prevName = 'Periode sebelumnya',
}: {
  data: Pt[];
  height?: number;
  fmt?: (v: number) => string;
  curName?: string;
  prevName?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  const [tip, setTip] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    setW(Math.max(280, el.clientWidth || 600));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW((w) => (Math.abs((el.clientWidth || 600) - w) > 4 ? Math.max(280, el.clientWidth) : w)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const ml = 46;
  const mr = 8;
  const mt = 12;
  const mb = 26;
  const PW = W - ml - mr;
  const PH = H - mt - mb;
  const n = Math.max(1, data.length);
  const hasPrev = data.some((d) => d.prev != null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value), ...(hasPrev ? data.map((d) => d.prev ?? 0) : [])));
  const band = PW / n;
  const bw = Math.max(1, Math.min(24, band - 2));
  const y = (v: number) => mt + PH - (Math.max(0, v) / max) * PH;
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(PW / 54))));
  const prevPts = hasPrev ? data.map((d, i) => `${ml + band * i + band / 2},${y(d.prev ?? 0)}`).join(' ') : '';
  const t = tip != null ? data[tip] : null;
  return (
    <div className="viz" ref={host}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={curName}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line className="gl" x1={ml} x2={W - mr} y1={y(v)} y2={y(v)} />
            <text x={ml - 8} y={y(v) + 4} textAnchor="end">
              {short(v)}
            </text>
          </g>
        ))}
        <line className="ax" x1={ml} x2={W - mr} y1={mt + PH} y2={mt + PH} />
        {data.map((d, i) => {
          const x = ml + band * i + (band - bw) / 2;
          const top = y(d.value);
          return (
            <g key={i}>
              <rect
                className="hit"
                x={ml + band * i}
                y={mt}
                width={band}
                height={PH}
                tabIndex={0}
                aria-label={`${d.full ?? d.label}: ${fmt(d.value)}`}
                onPointerEnter={() => setTip(i)}
                onPointerLeave={() => setTip(null)}
                onFocus={() => setTip(i)}
                onBlur={() => setTip(null)}
              />
              <path className="bar" d={barPath(x, top, bw, mt + PH - top)} />
            </g>
          );
        })}
        {hasPrev && <polyline className="ln muted" points={prevPts} pointerEvents="none" />}
        {data.map((d, i) =>
          i % every === 0 ? (
            <text key={`l${i}`} x={ml + band * i + band / 2} y={H - 8} textAnchor="middle">
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
      {t && tip != null && (
        <div
          className="viz-tip"
          style={{ left: Math.min(Math.max(ml + band * tip + band / 2, 70), W - 70), top: Math.max(y(Math.max(t.value, t.prev ?? 0)), mt + 30) }}
        >
          <small>{t.full ?? t.label}</small>
          <span className="tr">
            <i />
            <span className="tv">{fmt(t.value)}</span>
          </span>
          {t.prev != null && (
            <span className="tr">
              <i className="m" />
              <span>
                {prevName}: {fmt(t.prev)}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Batang horizontal (nilai selalu tertulis). */
export function HBars({ rows, fmt = (v: number) => String(v), share = true, empty = 'Belum ada data.' }: { rows: { label: string; value: number }[]; fmt?: (v: number) => string; share?: boolean; empty?: string }) {
  if (!rows.length) return <p className="muted" style={{ margin: '6px 0' }}>{empty}</p>;
  const total = rows.reduce((a, r) => a + Math.max(0, r.value), 0) || 1;
  const top = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="hbars">
      {rows.map((r, i) => (
        <div key={i} className="hbar" tabIndex={0} title={`${r.label}: ${fmt(r.value)}`}>
          <span className="hl">{r.label}</span>
          <span className="ht">
            <span className="hf" style={{ width: `${Math.max(0, (r.value / top) * 100).toFixed(2)}%` }} />
          </span>
          <span className="hv">
            {fmt(r.value)}
            {share && <small>{Math.round((Math.max(0, r.value) / total) * 100)}%</small>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Tabel sederhana untuk tampilan "Tabel" sebuah grafik. */
export function SimpleTable<T>({ cols, rows }: { cols: { label: string; r?: boolean; get: (r: T) => string }[]; rows: T[] }) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.label} className={c.r ? 'r' : ''}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.label} className={c.r ? 'r' : ''}>
                  {c.get(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Sakelar on/off (gaya .switch POS). */
export function Switch({ on, onChange, label, disabled, ...rest }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean } & Record<`data-${string}`, string>) {
  return (
    <button type="button" className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} {...rest} />
  );
}
