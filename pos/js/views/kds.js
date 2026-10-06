/* =========================================================
   Layar dapur/bar (KDS): tiket dari kasir, tandai selesai per item / per tiket.
   Status dapur disimpan terpisah dari pesanan (koleksi `kitchen`) supaya tidak
   bentrok dengan perubahan tagihan di kasir.
   ========================================================= */
import { S, branch, settings, today, nav } from '../state.js';
import { $, esc, icon, modal, toast, beep, audioReady } from '../lib/ui.js';
import { addDays, clock, ago } from '../core/dates.js';
import { markKitchen } from '../ops.js';
import { bus } from '../data/bus.js';

const LS = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
const LSset = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* noop */ } };

export async function mount(el) {
  const be = S.be; const b = branch();
  let station = LS('pos:kds:station', 'all');
  let sound = LS('pos:kds:sound', '0') === '1';
  let orders = []; let marks = []; let seen = null;

  el.innerHTML = `<div class="kds">
    <div class="kds-head">
      <h1>${icon('chef', 'lg')} Dapur</h1>
      <div class="seg" id="k-st"><button data-st="all">Semua</button><button data-st="bar">Bar</button><button data-st="kitchen">Dapur</button></div>
      <div class="kds-stat" id="k-stat"></div>
      <div class="right row">
        <button class="btn ghost sm" data-a="sound" id="k-sound"></button>
        <button class="btn ghost sm" data-a="recall">${icon('undo', 'sm')} Baru selesai</button>
        <button class="btn ghost sm" data-a="queue">${icon('tv', 'sm')} Layar antrean</button>
        <button class="btn ghost sm" data-a="full" aria-label="Layar penuh">${icon('monitor', 'sm')}</button>
      </div>
    </div>
    <div id="k-body"></div>
  </div>`;
  const body = $('#k-body', el);

  const doneOf = () => {
    const m = new Map();
    marks.forEach((k) => m.set(`${k.orderId}:${k.lineId}`, k));
    return m;
  };
  async function load() {
    const t = today();
    orders = (await be.ordersOf(b.id, addDays(t, -1), t)).filter((o) => o.kind === 'sale' && (o.status === 'open' || o.status === 'paid') && o.lines.some((l) => l.kAt));
    marks = await be.kitchenOf(b.id, Date.now() - 36 * 3600e3);
    render();
  }

  function tickets() {
    const dm = doneOf(); const out = [];
    for (const o of orders) {
      const lines = o.lines.filter((l) => l.kAt && (station === 'all' || l.station === station));
      const pending = lines.filter((l) => !l.voided && !(dm.get(`${o.id}:${l.id}`) || {}).done);
      if (!pending.length) continue;
      const since = Math.min(...pending.map((l) => l.kAt));
      out.push({ o, lines, pending, since, dm });
    }
    return out.sort((a, x) => a.since - x.since);
  }

  function render() {
    el.querySelectorAll('[data-st]').forEach((x) => x.classList.toggle('on', x.dataset.st === station));
    $('#k-sound', el).innerHTML = `${icon(sound ? 'volume' : 'volume-x', 'sm')} ${sound ? 'Bunyi aktif' : 'Bunyi mati'}`;
    const list = tickets();
    const now = Date.now(); const s = settings();
    const items = list.reduce((a, t) => a + t.pending.reduce((x, l) => x + l.qty, 0), 0);
    const oldest = list.length ? now - list[0].since : 0;
    $('#k-stat', el).innerHTML = `<span><b>${list.length}</b> tiket</span><span><b>${items}</b> item</span>${list.length ? `<span>terlama <b>${ago(oldest)}</b></span>` : ''}`;
    // tiket baru → bunyi
    const ids = new Set(list.map((t) => `${t.o.id}:${t.pending.map((l) => l.id).join(',')}`));
    if (seen && sound) { for (const id of ids) if (!seen.has(id)) { beep(2); break; } }
    seen = ids;
    if (!list.length) {
      body.innerHTML = `<div class="kds-empty"><div>${icon('check-circle', 'lg')}<b>Semua pesanan beres</b>Tiket baru dari kasir muncul di sini otomatis.</div></div>`;
      return;
    }
    body.innerHTML = `<div class="tickets">${list.map(({ o, lines, pending, since, dm }) => {
      const age = now - since; const min = age / 60000;
      const cls = min >= (s.kdsLateMin || 15) ? 'late' : min >= (s.kdsWarnMin || 8) ? 'warn' : '';
      const batches = [...new Set(lines.map((l) => l.kAt))].sort((a, x) => a - x);
      return `<article class="ticket ${cls}">
        <div class="t-head"><div><div class="tq">${esc(o.queueNo)}</div><div class="tw">${o.table ? `Meja ${esc(o.table)}` : ''}${o.table && o.customer && o.customer.name ? ' · ' : ''}${esc((o.customer && o.customer.name) || '')}</div><span class="t-ch">${esc(o.channelName || '')}</span></div>
          <div class="tt"><b>${ago(age)}</b><small>${clock(since, b.tz)} · ${o.status === 'paid' ? 'lunas' : 'tagihan'}</small></div></div>
        <div class="t-lines">${batches.map((bt, i) => `${i ? `<div class="t-batch">Tambahan · ${clock(bt, b.tz)}</div>` : ''}${lines.filter((l) => l.kAt === bt).map((l) => {
          const dn = (dm.get(`${o.id}:${l.id}`) || {}).done;
          return `<button class="t-line ${dn ? 'done' : ''} ${l.voided ? 'void' : ''}" data-ln="${o.id}:${l.id}" ${l.voided ? 'disabled' : ''}>
            <span class="tq2">${l.qty}×</span><span><b>${esc(l.name)}</b>${l.sum ? `<small>${esc(l.sum)}</small>` : ''}${l.note ? `<small class="tn">⚑ ${esc(l.note)}</small>` : ''}${l.voided ? '<small>DIBATALKAN</small>' : ''}${station === 'all' ? `<small class="other">${l.station === 'bar' ? 'Bar' : 'Dapur'}</small>` : ''}</span></button>`;
        }).join('')}`).join('')}</div>
        <div class="t-foot"><button class="btn" data-bump="${o.id}">${icon('check', 'sm')} Selesai${pending.length < lines.filter((l) => !l.voided).length ? ` (${pending.length})` : ''}</button></div>
      </article>`;
    }).join('')}</div>`;
  }

  async function toggleLine(key) {
    const [oid, lid] = key.split(':');
    const o = orders.find((x) => x.id === oid); if (!o) return;
    const cur = marks.find((k) => k.orderId === oid && k.lineId === lid);
    await markKitchen(o, [lid], !(cur && cur.done));
  }
  async function bump(oid) {
    const t = tickets().find((x) => x.o.id === oid); if (!t) return;
    await markKitchen(t.o, t.pending.map((l) => l.id), true);
    toast(`Antrean ${t.o.queueNo} selesai`);
  }
  function recall() {
    const since = Date.now() - 45 * 60e3;
    const recent = new Map();
    marks.filter((k) => k.done && k.at >= since).forEach((k) => { const o = orders.find((x) => x.id === k.orderId); if (o) recent.set(o.id, { o, at: Math.max(k.at, (recent.get(o.id) || {}).at || 0) }); });
    const list = [...recent.values()].sort((a, x) => x.at - a.at).slice(0, 20);
    const m = modal({
      title: 'Baru selesai', sub: '45 menit terakhir. Kembalikan tiket bila terlanjur ditandai selesai.', size: 'sm',
      body: list.length ? `<div class="list">${list.map(({ o, at }) => `<div class="li" style="grid-template-columns:auto 1fr auto"><span class="lq">${esc(o.queueNo)}</span><div><b>${o.table ? `Meja ${esc(o.table)}` : esc((o.customer && o.customer.name) || o.channelName || '')}</b><small>selesai ${clock(at, b.tz)}</small></div><button class="btn sm ghost" data-undo="${o.id}">${icon('undo', 'sm')} Kembalikan</button></div>`).join('')}</div>` : '<p class="muted">Belum ada.</p>',
    });
    m.el.addEventListener('click', async (e) => {
      const u = e.target.closest('[data-undo]'); if (!u) return;
      const o = orders.find((x) => x.id === u.dataset.undo);
      const ids = marks.filter((k) => k.orderId === o.id && k.done && k.at >= since).map((k) => k.lineId);
      await markKitchen(o, ids, false);
      m.close(); toast(`Antrean ${o.queueNo} dikembalikan`);
    });
  }

  el.addEventListener('click', async (e) => {
    const st = e.target.closest('[data-st]'); if (st) { station = st.dataset.st; LSset('pos:kds:station', station); render(); return; }
    const ln = e.target.closest('[data-ln]'); if (ln) { await toggleLine(ln.dataset.ln); return; }
    const bp = e.target.closest('[data-bump]'); if (bp) { await bump(bp.dataset.bump); return; }
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'sound') {
      sound = !sound; LSset('pos:kds:sound', sound ? '1' : '0');
      if (sound) beep(1);
      render();
    }
    if (a.dataset.a === 'recall') recall();
    if (a.dataset.a === 'queue') nav('antrean');
    if (a.dataset.a === 'full') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
  });

  await load();
  if (sound && !audioReady()) toast('Ketuk layar sekali untuk mengaktifkan bunyi tiket baru', 'warn', 4000);
  const timer = setInterval(render, 15000);
  const poll = setInterval(load, be.isServer ? 20000 : 60000);
  const offs = [bus.on('orders', load), bus.on('kitchen', load)];
  return () => { clearInterval(timer); clearInterval(poll); offs.forEach((f) => f()); };
}
