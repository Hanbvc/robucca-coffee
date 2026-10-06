/* =========================================================
   Grafik ringan (SVG/HTML, tanpa pustaka) untuk Kantor.
   Aturan: satu warna aksen (+ abu untuk periode pembanding), batang ≤24px dengan
   ujung membulat 4px, garis bantu tipis, tooltip saat hover/fokus, dan tabel
   sebagai alternatif aksesibel untuk setiap grafik.
   ========================================================= */
import { esc } from '../lib/ui.js';
import { short } from '../core/money.js';

function niceMax(v) {
  if (v <= 0) return 1;
  const raw = v / 4; const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= raw) || 10 * mag;
  return step * 4;
}
const barPath = (x, y, w, h, r = 4) => {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  const y0 = y + h;
  return `M${x},${y0}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y0}Z`;
};

/**
 * Grafik kolom (deret waktu).
 * data: [{ label, full, value, prev? }]; fmt: format nilai tooltip
 */
export function columnChart(host, { data, height = 230, fmt = (v) => v, curName = 'Periode ini', prevName = 'Periode sebelumnya' }) {
  const draw = () => {
    const W = Math.max(280, host.clientWidth || 600); const H = height;
    const ml = 46; const mr = 8; const mt = 12; const mb = 26;
    const PW = W - ml - mr; const PH = H - mt - mb;
    const n = Math.max(1, data.length);
    const hasPrev = data.some((d) => d.prev != null);
    const max = niceMax(Math.max(0, ...data.map((d) => d.value), ...(hasPrev ? data.map((d) => d.prev || 0) : [])));
    const band = PW / n;
    const bw = Math.max(1, Math.min(24, band - 2));
    const y = (v) => mt + PH - (Math.max(0, v) / max) * PH;
    const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(PW / 54))));
    const prevPts = hasPrev ? data.map((d, i) => `${ml + band * i + band / 2},${y(d.prev || 0)}`).join(' ') : '';
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(curName)}">
      ${ticks.map((t) => `<line class="gl" x1="${ml}" x2="${W - mr}" y1="${y(t)}" y2="${y(t)}"/><text x="${ml - 8}" y="${y(t) + 4}" text-anchor="end">${esc(short(t))}</text>`).join('')}
      <line class="ax" x1="${ml}" x2="${W - mr}" y1="${mt + PH}" y2="${mt + PH}"/>
      ${data.map((d, i) => {
        const x = ml + band * i + (band - bw) / 2; const top = y(d.value);
        return `<g><rect class="hit" x="${ml + band * i}" y="${mt}" width="${band}" height="${PH}" tabindex="0" data-i="${i}" aria-label="${esc(d.full || d.label)}: ${esc(fmt(d.value))}"/><path class="bar" d="${barPath(x, top, bw, mt + PH - top)}"/></g>`;
      }).join('')}
      ${hasPrev ? `<polyline class="ln muted" points="${prevPts}" pointer-events="none"/>` : ''}
      ${data.map((d, i) => (i % every === 0 ? `<text x="${ml + band * i + band / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>` : '')).join('')}
    </svg><div class="viz-tip" hidden></div>`;
    const tip = host.querySelector('.viz-tip');
    const show = (e) => {
      const i = +e.target.dataset.i; const d = data[i];
      const x = ml + band * i + band / 2;
      tip.innerHTML = `<small>${esc(d.full || d.label)}</small><span class="tr"><i></i><span class="tv">${esc(fmt(d.value))}</span></span>${d.prev != null ? `<span class="tr"><i class="m"></i><span>${esc(prevName)}: ${esc(fmt(d.prev))}</span></span>` : ''}`;
      tip.hidden = false;
      tip.style.left = `${Math.min(Math.max(x, 70), W - 70)}px`;
      tip.style.top = `${Math.max(y(Math.max(d.value, d.prev || 0)), mt + 30)}px`;
    };
    const hide = () => { tip.hidden = true; };
    host.querySelectorAll('.hit').forEach((h) => {
      h.addEventListener('pointerenter', show); h.addEventListener('focus', show);
      h.addEventListener('pointerleave', hide); h.addEventListener('blur', hide);
    });
  };
  draw();
  let ro = null; let lastW = host.clientWidth;
  if (window.ResizeObserver) {
    ro = new ResizeObserver(() => { if (Math.abs(host.clientWidth - lastW) > 4) { lastW = host.clientWidth; draw(); } });
    ro.observe(host);
  }
  return () => ro && ro.disconnect();
}

/** Batang horizontal (nilai selalu tertulis, jadi tidak butuh tabel terpisah) */
export function hbarsHTML(rows, { fmt = (v) => v, share = true, max = null, empty = 'Belum ada data.' } = {}) {
  if (!rows.length) return `<p class="muted" style="margin:6px 0">${esc(empty)}</p>`;
  const total = rows.reduce((a, r) => a + Math.max(0, r.value), 0) || 1;
  const top = max || Math.max(...rows.map((r) => r.value), 1);
  return `<div class="hbars">${rows.map((r) => `<div class="hbar" tabindex="0" title="${esc(r.label)}: ${esc(fmt(r.value))}">
    <span class="hl">${esc(r.label)}</span>
    <span class="ht"><span class="hf" style="width:${Math.max(0, (r.value / top) * 100).toFixed(2)}%"></span></span>
    <span class="hv">${esc(fmt(r.value))}${share ? `<small>${Math.round((Math.max(0, r.value) / total) * 100)}%</small>` : ''}</span></div>`).join('')}</div>`;
}

/** Tabel sederhana untuk tampilan "Tabel" sebuah grafik */
export function tableHTML(cols, rows) {
  return `<div class="table-scroll"><table class="table"><thead><tr>${cols.map((c) => `<th class="${c.r ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.r ? 'r' : ''}">${esc(c.get(r))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
