/* Bagian bersama halaman Kantor: filter periode & cabang, tabel, ekspor. */
import { S, master, can, today } from '../../state.js';
import { $, esc, icon, download } from '../../lib/ui.js';
import { PRESETS, presetRange, rangeLabel } from '../../core/dates.js';
import { staffBranches } from '../../core/perms.js';
import { toCSV } from '../../core/report.js';

const KEY = 'pos:office:filter';
export const F = (() => {
  try { return { preset: '7d', from: '', to: '', branch: 'all', ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch (e) { return { preset: '7d', from: '', to: '', branch: 'all' }; }
})();
const saveF = () => { try { sessionStorage.setItem(KEY, JSON.stringify(F)); } catch (e) { /* noop */ } };

/** Cabang yang boleh dilihat pengguna */
export function myBranches() {
  const all = master().activeBranches();
  const ids = staffBranches(S.user);
  return ids.includes('*') ? all : all.filter((b) => ids.includes(b.id));
}
export function branchIds() {
  const mine = myBranches();
  if (F.branch !== 'all' && mine.some((b) => b.id === F.branch)) return [F.branch];
  if (can('office.all')) return null; // semua cabang
  return mine.map((b) => b.id);
}
export function range() {
  if (F.preset === 'custom' && F.from && F.to) return F.from <= F.to ? { from: F.from, to: F.to } : { from: F.to, to: F.from };
  return presetRange(F.preset === 'custom' ? '7d' : F.preset, today());
}
export const branchName = (id) => (master().branch[id] || {}).name || id;
export const scopeLabel = () => { const ids = branchIds(); return !ids ? 'Semua cabang' : ids.length === 1 ? branchName(ids[0]) : `${ids.length} cabang`; };

export function filterBar({ period = true, branch = true, extra = '' } = {}) {
  const mine = myBranches();
  const r = range();
  return `<div class="filters" role="group" aria-label="Filter">
    ${period ? `${PRESETS.map(([k, l]) => `<button class="chip sm ${F.preset === k ? 'on' : ''}" data-preset="${k}">${l}</button>`).join('')}
      <button class="chip sm ${F.preset === 'custom' ? 'on' : ''}" data-preset="custom">${icon('calendar', 'xs')} Pilih tanggal</button>
      ${F.preset === 'custom' ? `<span class="custom-range"><input class="input" type="date" data-from value="${esc(F.from || r.from)}" aria-label="Dari tanggal"><span class="muted">–</span><input class="input" type="date" data-to value="${esc(F.to || r.to)}" aria-label="Sampai tanggal"></span>` : `<span class="range-label">${esc(rangeLabel(r))}</span>`}` : ''}
    ${branch && (mine.length > 1 || can('office.all')) ? `<span class="sep"></span><select class="select sm" data-branch aria-label="Cabang">
        ${can('office.all') || mine.length > 1 ? `<option value="all" ${F.branch === 'all' ? 'selected' : ''}>${can('office.all') ? 'Semua cabang' : 'Semua cabang saya'}</option>` : ''}
        ${mine.map((b) => `<option value="${b.id}" ${F.branch === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
      </select>` : ''}
    ${extra}
  </div>`;
}

/** Pasang event filter; onChange dipanggil setelah filter berubah */
export function wireFilters(el, onChange) {
  el.addEventListener('click', (e) => {
    const p = e.target.closest('[data-preset]'); if (!p) return;
    F.preset = p.dataset.preset;
    if (F.preset === 'custom' && !F.from) { const r = presetRange('7d', today()); F.from = r.from; F.to = r.to; }
    saveF(); onChange();
  });
  el.addEventListener('change', (e) => {
    if (e.target.matches('[data-branch]')) { F.branch = e.target.value; saveF(); onChange(); }
    if (e.target.matches('[data-from]')) { F.from = e.target.value; saveF(); onChange(); }
    if (e.target.matches('[data-to]')) { F.to = e.target.value; saveF(); onChange(); }
  });
}

export function pageHead(title, sub = '', actions = '') {
  return `<div class="topbar"><div><h1>${esc(title)}</h1>${sub ? `<div class="crumb">${sub}</div>` : ''}</div>${actions ? `<div class="right row wrap">${actions}</div>` : ''}</div>`;
}

export const demoNote = () => (S.be.isDemo ? `<div class="note" style="margin-bottom:14px">${icon('info', 'sm')}<span><b>Mode demo:</b> angka berasal dari riwayat transaksi contoh (simulasi) ditambah transaksi yang Anda buat di perangkat ini — bukan penjualan asli Robucca.</span></div>` : '');

export function exportCSV(name, rows, cols) {
  const r = range();
  download(`robucca-${name}-${r.from}_${r.to}.csv`, toCSV(rows, cols));
}

/** Tabel yang bisa diurutkan. cols: [{ key, label, r, get(row) → teks, html?(row), sort?(row) }] */
export function sortableTable(host, cols, rows, { sortKey = null, desc = true, foot = null, onRow = null, rowAttr = null } = {}) {
  let key = sortKey; let dsc = desc;
  const paint = () => {
    const c = cols.find((x) => x.key === key);
    const list = c ? [...rows].sort((a, b) => {
      const va = c.sort ? c.sort(a) : c.get(a); const vb = c.sort ? c.sort(b) : c.get(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'id');
      return dsc ? -cmp : cmp;
    }) : rows;
    host.innerHTML = `<div class="table-scroll"><table class="table"><thead><tr>${cols.map((x) => `<th class="sort ${x.r ? 'r' : ''}" data-sort="${x.key}" aria-sort="${x.key === key ? (dsc ? 'descending' : 'ascending') : 'none'}">${esc(x.label)}${x.key === key ? (dsc ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
      <tbody>${list.length ? list.map((r) => `<tr ${onRow ? `class="click" ${rowAttr ? rowAttr(r) : ''}` : ''}>${cols.map((x) => `<td class="${x.r ? 'r' : ''}">${x.html ? x.html(r) : esc(x.get(r))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:28px">Belum ada data untuk periode ini.</td></tr>`}</tbody>
      ${foot && list.length ? `<tfoot><tr>${foot.map((f, i) => `<td class="${cols[i] && cols[i].r ? 'r' : ''}">${esc(f)}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
  };
  host.addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (th) { if (key === th.dataset.sort) dsc = !dsc; else { key = th.dataset.sort; dsc = true; } paint(); return; }
    if (onRow) { const tr = e.target.closest('tr.click'); if (tr) onRow(tr); }
  });
  paint();
  return { update(r) { rows = r; paint(); } };
}

export const needOnline = (el, retry) => {
  el.innerHTML = `<div class="empty"><div class="em-ico">${icon('wifi-off', 'lg')}</div><h3>Perlu koneksi ke server</h3><p>Data kantor diambil langsung dari server pusat.</p><button class="btn" data-retry>${icon('rotate', 'sm')} Coba lagi</button></div>`;
  $('[data-retry]', el).addEventListener('click', retry);
};
