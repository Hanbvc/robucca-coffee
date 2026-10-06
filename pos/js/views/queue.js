/* Layar antrean untuk pelanggan: "Sedang disiapkan" & "Siap diambil". */
import { S, branch, settings, today, nav } from '../state.js';
import { $, esc, icon } from '../lib/ui.js';
import { addDays, clock } from '../core/dates.js';
import { kitchenState } from '../ops.js';
import { bus } from '../data/bus.js';

const READY_SHOW_MIN = 10;

export async function mount(el) {
  const be = S.be; const b = branch();
  el.innerHTML = `<div class="queue">
    <div class="q-head"><img src="../assets/brand/wordmark-light.png" alt="Robucca"><div><b style="font-size:20px">${esc(b.name)}</b><div style="opacity:.8">Pantau nomor antrean Anda</div></div><div class="q-clock" id="q-clock"></div>
      <button class="btn ghost sm" data-exit style="color:var(--cream);box-shadow:inset 0 0 0 1.5px rgba(250,238,218,.3);margin-left:14px" aria-label="Keluar dari layar antrean">${icon('x', 'sm')}</button></div>
    <div class="q-cols"><section class="q-col"><h2>Sedang disiapkan</h2><div class="q-nums" id="q-prep"></div></section><section class="q-col ready"><h2>Siap diambil</h2><div class="q-nums" id="q-ready"></div></section></div>
    <div class="q-foot">Terima kasih sudah menunggu${settings().instagram ? ` · ${esc(settings().instagram)}` : ''}</div>
  </div>`;

  async function load() {
    const t = today();
    const orders = (await be.ordersOf(b.id, addDays(t, -1), t)).filter((o) => o.kind === 'sale' && (o.status === 'open' || o.status === 'paid') && o.lines.some((l) => l.kAt && !l.voided));
    const marks = await be.kitchenOf(b.id, Date.now() - 24 * 3600e3);
    const now = Date.now(); const prep = []; const ready = [];
    for (const o of orders) {
      const k = kitchenState(o, marks);
      if (!k.sent) continue;
      if (k.ready) { if (now - k.readyAt < READY_SHOW_MIN * 60e3) ready.push({ o, at: k.readyAt }); } else prep.push({ o, at: o.createdAt });
    }
    prep.sort((a, x) => a.at - x.at); ready.sort((a, x) => x.at - a.at);
    const card = ({ o }) => `<div class="q-num"><b>${esc(o.queueNo)}</b><small>${esc((o.customer && o.customer.name ? o.customer.name.split(' ')[0] : '') || (o.table ? `Meja ${o.table}` : ''))}</small></div>`;
    $('#q-prep', el).innerHTML = prep.slice(0, 24).map(card).join('') || '<span style="opacity:.7;font-size:18px">—</span>';
    $('#q-ready', el).innerHTML = ready.slice(0, 18).map(card).join('') || '<span style="opacity:.6;font-size:18px">—</span>';
  }
  const tick = () => { const c = $('#q-clock', el); if (c) c.textContent = clock(Date.now(), b.tz); };
  el.addEventListener('click', (e) => { if (e.target.closest('[data-exit]')) nav('dapur'); });
  tick(); await load();
  const t1 = setInterval(tick, 10000); const t2 = setInterval(load, 15000);
  const offs = [bus.on('orders', load), bus.on('kitchen', load)];
  return () => { clearInterval(t1); clearInterval(t2); offs.forEach((f) => f()); };
}
