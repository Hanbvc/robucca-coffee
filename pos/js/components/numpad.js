/* Papan angka untuk nominal Rupiah (pembayaran, kas awal, hitung kas). */
import { icon } from '../lib/ui.js';

export const numpadHTML = () => `<div class="numpad" role="group" aria-label="Papan angka">
  ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => `<button type="button" data-np="${d}">${d}</button>`).join('')}
  <button type="button" data-np="000">000</button><button type="button" data-np="0">0</button>
  <button type="button" class="fn" data-np="del" aria-label="Hapus">${icon('chevron-left')}</button>
  <button type="button" class="fn" data-np="clr" style="grid-column:span 3;height:42px">Hapus semua</button>
</div>`;

/** Terapkan tombol ke nilai (string digit) → nilai baru */
export function npKey(val, k, max = 12) {
  let v = String(val || '');
  if (k === 'del') v = v.slice(0, -1);
  else if (k === 'clr') v = '';
  else if (/^\d+$/.test(k)) v = (v + k).replace(/^0+(?=\d)/, '');
  if (v.length > max) v = v.slice(0, max);
  return v;
}

/** Tombol fisik keyboard → kunci numpad */
export function keyToNp(e) {
  if (/^\d$/.test(e.key)) return e.key;
  if (e.key === 'Backspace') return 'del';
  if (e.key === 'Delete') return 'clr';
  return null;
}
