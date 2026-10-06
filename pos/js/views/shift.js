/* Shift kasir: buka dengan kas awal, kas masuk/keluar, tutup & hitung kas. */
import { S, branch, settings, today } from '../state.js';
import { $, esc, icon, modal, toast, confirmBox } from '../lib/ui.js';
import { rp } from '../core/money.js';
import { dateTime, clock, ago } from '../core/dates.js';
import { shiftSummary } from '../core/report.js';
import { uuid } from '../core/ids.js';
import { numpadHTML, npKey, keyToNp } from '../components/numpad.js';
import { shiftHTML, printHTML } from '../components/receipt.js';
import { bus } from '../data/bus.js';
import { logout } from '../app.js';

const DENOMS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];

/** Dialog nominal dengan numpad. Kembalikan angka atau null. */
export function amountDialog({ title, sub = '', ok = 'Simpan', quick = [], value = '', reason = false, reasons = [], allowZero = true }) {
  let v = String(value || '');
  const m = modal({
    title, sub, size: 'sm',
    body: `<div class="amount-box" style="margin-top:0"><label>Nominal</label><div class="big num" id="ad-v"></div></div>
      ${quick.length ? `<div class="quick-cash">${quick.map((q) => `<button class="chip" data-q="${q}">${q ? rp(q) : 'Rp0'}</button>`).join('')}</div>` : ''}
      <div style="margin-top:12px">${numpadHTML()}</div>
      ${reason ? `<label class="field" style="margin-top:12px"><span>Keterangan</span><input class="input" id="ad-r" placeholder="mis. beli es batu" autocomplete="off"></label>
        ${reasons.length ? `<div class="quick-notes">${reasons.map((r) => `<button class="chip sm" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}` : ''}
      <p class="err-text" id="ad-err" hidden></p>`,
    foot: `<button class="btn ghost" data-close>Batal</button><button class="btn" data-ok>${esc(ok)}</button>`,
  });
  const show = () => { $('#ad-v', m.el).textContent = rp(v ? parseInt(v, 10) : 0); };
  show();
  m.el.addEventListener('click', (e) => {
    const k = e.target.closest('[data-np]'); if (k) { v = npKey(v, k.dataset.np); show(); return; }
    const q = e.target.closest('[data-q]'); if (q) { v = q.dataset.q; show(); return; }
    const r = e.target.closest('[data-r]'); if (r) { $('#ad-r', m.el).value = r.dataset.r; return; }
    if (e.target.closest('[data-ok]')) {
      const n = v ? parseInt(v, 10) : 0;
      const err = $('#ad-err', m.el);
      if (!allowZero && n <= 0) { err.textContent = 'Nominal harus lebih dari 0.'; err.hidden = false; return; }
      const why = reason ? $('#ad-r', m.el).value.trim() : '';
      if (reason && !why) { err.textContent = 'Isi keterangan.'; err.hidden = false; return; }
      m.close(reason ? { amount: n, reason: why } : n);
    }
  });
  const onKey = (e) => { if (e.target.tagName === 'INPUT') return; const k = keyToNp(e); if (k) { v = npKey(v, k); show(); } else if (e.key === 'Enter') $('[data-ok]', m.el).click(); };
  document.addEventListener('keydown', onKey);
  m.result.then(() => document.removeEventListener('keydown', onKey));
  return m.result.then((x) => (x === undefined ? null : x));
}

export async function openShiftDialog() {
  const b = branch();
  const amount = await amountDialog({
    title: 'Buka shift kasir', sub: `${esc(b.name)} · Terminal ${S.be.device.terminalNo}. Hitung uang di laci sebagai kas awal.`,
    ok: 'Buka shift', quick: [0, 200000, 300000, 500000, 1000000],
  });
  if (amount == null) return null;
  const now = Date.now();
  const shift = {
    id: uuid(), branchId: b.id, deviceId: S.be.device.id, terminalNo: S.be.device.terminalNo, bizDate: today(),
    openedAt: now, openedBy: S.user.id, openedByName: S.user.name, openingCash: amount, status: 'open', createdAt: now,
  };
  S.shift = await S.be.save('shifts', shift);
  await S.be.audit('shift.open', { openingCash: amount, terminal: shift.terminalNo }, S.user);
  toast(`Shift dibuka · kas awal ${rp(amount)}`);
  return S.shift;
}

async function summaryOf(shift) {
  const orders = await S.be.shiftOrders(shift.id, shift.branchId);
  const moves = await S.be.cashMovesOf(shift.id);
  return { sum: shiftSummary(shift, orders, moves), moves, orders };
}

export async function mount(el) {
  const b = branch();
  const render = async () => {
    S.shift = await S.be.currentShift();
    const sh = S.shift;
    if (!sh) {
      el.innerHTML = `<div class="topbar"><h1>Shift kasir</h1></div><div class="page"><div class="empty"><div class="em-ico">${icon('wallet', 'lg')}</div><h3>Belum ada shift terbuka</h3><p>Buka shift dengan menghitung kas awal di laci sebelum mulai berjualan.</p><button class="btn" data-a="open">${icon('plus', 'sm')} Buka shift</button></div></div>`;
      return;
    }
    const { sum, moves } = await summaryOf(sh);
    const tz = b.tz;
    el.innerHTML = `<div class="topbar"><div><h1>Shift kasir</h1><div class="crumb">Terminal ${sh.terminalNo} · dibuka ${dateTime(sh.openedAt, tz)} oleh ${esc(sh.openedByName)} · berjalan ${ago(Date.now() - sh.openedAt)}</div></div>
        <div class="right row"><button class="btn ghost sm" data-a="x">${icon('printer', 'sm')} Cetak laporan sementara</button><button class="btn danger" data-a="close">${icon('lock', 'sm')} Tutup shift</button></div></div>
      <div class="page">
        <div class="kpis">
          <div class="kpi"><div class="k-label">Kas seharusnya di laci</div><div class="k-value">${rp(sum.expected)}</div><div class="k-sub">Kas awal ${rp(sh.openingCash)}</div></div>
          <div class="kpi"><div class="k-label">Penjualan shift</div><div class="k-value">${rp(sum.total)}</div><div class="k-sub">${sum.count} transaksi${sum.refunds ? ` · ${sum.refunds} refund` : ''}${sum.voids ? ` · ${sum.voids} void` : ''}</div></div>
          <div class="kpi"><div class="k-label">Tunai dari penjualan</div><div class="k-value">${rp(sum.cashSales - sum.cashRefunds)}</div><div class="k-sub">${sum.cashRefunds ? `refund tunai ${rp(sum.cashRefunds)}` : 'termasuk kembalian'}</div></div>
          <div class="kpi"><div class="k-label">Kas masuk / keluar</div><div class="k-value">${rp(sum.cashIn - sum.cashOut)}</div><div class="k-sub">+${rp(sum.cashIn)} / −${rp(sum.cashOut)}</div></div>
        </div>
        <div class="two-col">
          <div class="table-card">
            <div class="row" style="padding:14px 16px 6px"><h3 style="margin:0;font-size:15px">Kas masuk & keluar</h3><div class="right row"><button class="btn soft sm" data-a="in">${icon('plus', 'sm')} Kas masuk</button><button class="btn soft sm" data-a="out">${icon('minus', 'sm')} Kas keluar</button></div></div>
            ${moves.length ? `<table class="table"><thead><tr><th>Waktu</th><th>Keterangan</th><th>Oleh</th><th class="r">Nominal</th></tr></thead><tbody>
              ${moves.sort((a, x) => x.at - a.at).map((mv) => `<tr><td class="n">${clock(mv.at, tz)}</td><td>${esc(mv.reason)}</td><td>${esc(mv.byName || '')}</td><td class="r ${mv.type === 'in' ? 'pos' : 'neg'}">${mv.type === 'in' ? '+' : '−'}${rp(mv.amount)}</td></tr>`).join('')}
            </tbody></table>` : '<p class="muted" style="padding:6px 16px 16px;margin:0">Belum ada kas masuk/keluar. Catat setiap uang yang diambil atau ditambahkan ke laci agar hitungan kas cocok.</p>'}
          </div>
          <div class="card pad">
            <h3 class="card-title">${icon('wallet', 'sm')} Per metode pembayaran</h3>
            ${sum.byMethod.length ? sum.byMethod.map((p) => `<div class="sum-row" style="padding:6px 0;border-bottom:1px solid var(--line-2)"><span>${esc(p.name)} <span class="muted">· ${p.count}x</span></span><b class="num">${rp(p.amount)}</b></div>`).join('') : '<p class="muted" style="margin:0">Belum ada transaksi.</p>'}
          </div>
        </div>
      </div>`;
  };

  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const act = a.dataset.a;
    if (act === 'open') { if (await openShiftDialog()) render(); return; }
    const sh = S.shift; if (!sh) return;
    if (act === 'in' || act === 'out') {
      const r = await amountDialog({
        title: act === 'in' ? 'Kas masuk' : 'Kas keluar', sub: act === 'in' ? 'Uang yang ditambahkan ke laci (mis. tambahan uang kembalian).' : 'Uang yang diambil dari laci (mis. belanja kecil, setor).',
        reason: true, reasons: act === 'in' ? ['Tambahan uang kembalian', 'Setoran dari manajer'] : ['Beli es batu', 'Beli gas', 'Belanja bahan', 'Setor ke bank'], allowZero: false,
      });
      if (!r) return;
      const doc = { id: uuid(), branchId: sh.branchId, shiftId: sh.id, type: act, amount: r.amount, reason: r.reason, by: S.user.id, byName: S.user.name, at: Date.now() };
      await S.be.save('cashMoves', doc);
      await S.be.audit(act === 'in' ? 'cash.in' : 'cash.out', { amount: r.amount, reason: r.reason }, S.user);
      toast(`${act === 'in' ? 'Kas masuk' : 'Kas keluar'} ${rp(r.amount)} dicatat`);
      render();
    }
    if (act === 'x') {
      const { sum } = await summaryOf(sh);
      printHTML(shiftHTML(sh, sum, { branch: b, settings: settings() }), { paper: b.paper, title: 'Laporan shift' });
    }
    if (act === 'close') closeShift(sh);
  });

  async function closeShift(sh) {
    const open = await S.be.openOrders(b.id);
    const mine = open.filter((o) => o.deviceId === S.be.device.id);
    if (mine.length && !(await confirmBox({ title: 'Masih ada tagihan terbuka', text: `${mine.length} tagihan dari terminal ini belum dibayar. Tagihan tetap tersimpan dan bisa dibayar di shift berikutnya. Lanjut tutup shift?`, ok: 'Lanjut' }))) return;
    const { sum } = await summaryOf(sh);
    const counts = Object.fromEntries(DENOMS.map((d) => [d, 0]));
    let mode = 'count'; let direct = '';
    const m = modal({
      title: 'Tutup shift', sub: 'Hitung uang tunai di laci, lalu bandingkan dengan kas seharusnya.', size: 'lg',
      body: '<div id="cs"></div>',
      foot: '<button class="btn ghost" data-close>Batal</button><button class="btn danger" data-ok>Tutup shift</button>',
    });
    const box = $('#cs', m.el);
    const counted = () => (mode === 'count' ? DENOMS.reduce((a, d) => a + d * counts[d], 0) : (direct ? parseInt(direct, 10) : 0));
    const paint = () => {
      const c = counted(); const diff = c - sum.expected;
      box.innerHTML = `<div class="seg" style="margin-bottom:14px"><button class="${mode === 'count' ? 'on' : ''}" data-mode="count">Hitung pecahan</button><button class="${mode === 'direct' ? 'on' : ''}" data-mode="direct">Masukkan total</button></div>
        <div class="pay-wrap">
          <div>${mode === 'count'
            ? `<table class="table"><tbody>${DENOMS.map((d) => `<tr><td class="n">${rp(d)}</td><td><div class="stepper" style="padding:2px"><button data-dn="${d}" data-dd="-1" aria-label="Kurangi">${icon('minus', 'sm')}</button><b>${counts[d]}</b><button data-dn="${d}" data-dd="1" aria-label="Tambah">${icon('plus', 'sm')}</button></div></td><td class="r">${rp(d * counts[d])}</td></tr>`).join('')}</tbody></table>`
            : `<div class="amount-box" style="margin-top:0"><label>Total uang di laci</label><div class="big num">${rp(c)}</div></div><div style="margin-top:12px">${numpadHTML()}</div>`}
          </div>
          <div class="col">
            <div class="mini"><small>Kas seharusnya</small><b>${rp(sum.expected)}</b></div>
            <div class="mini"><small>Kas dihitung</small><b>${rp(c)}</b></div>
            <div class="mini" style="background:${diff === 0 ? 'var(--green-soft)' : 'var(--red-soft)'}"><small>Selisih</small><b class="${diff === 0 ? 'pos' : 'neg'}">${diff > 0 ? '+' : ''}${rp(diff)}</b></div>
            <label class="field"><span>Catatan ${diff ? '<em>(wajib bila ada selisih)</em>' : '<em>(opsional)</em>'}</span><textarea class="textarea" id="cs-note" rows="3" placeholder="mis. uang kembalian kurang Rp2.000">${esc(box.dataset.note || '')}</textarea></label>
            <p class="err-text" id="cs-err" hidden></p>
          </div>
        </div>`;
    };
    paint();
    m.el.addEventListener('input', (e) => { if (e.target.id === 'cs-note') box.dataset.note = e.target.value; });
    m.el.addEventListener('click', async (e) => {
      const md = e.target.closest('[data-mode]'); if (md) { mode = md.dataset.mode; paint(); return; }
      const dn = e.target.closest('[data-dn]'); if (dn) { const d = +dn.dataset.dn; counts[d] = Math.max(0, counts[d] + +dn.dataset.dd); paint(); return; }
      const k = e.target.closest('[data-np]'); if (k) { direct = npKey(direct, k.dataset.np); paint(); return; }
      if (!e.target.closest('[data-ok]')) return;
      const c = counted(); const diff = c - sum.expected; const note = (box.dataset.note || '').trim();
      if (diff && !note) { const er = $('#cs-err', m.el); er.textContent = 'Jelaskan selisih kas di catatan.'; er.hidden = false; return; }
      const now = Date.now();
      const closed = { ...sh, status: 'closed', closedAt: now, closedBy: S.user.id, closedByName: S.user.name, countedCash: c, expectedCash: sum.expected, difference: diff, note, summary: sum, denoms: mode === 'count' ? counts : null };
      await S.be.save('shifts', closed);
      await S.be.audit('shift.close', { expected: sum.expected, counted: c, difference: diff, note }, S.user);
      m.close();
      S.shift = null;
      const done = modal({
        title: 'Shift ditutup', size: 'sm',
        body: `<div class="done-box"><div class="ok">${icon('check', 'lg')}</div><b>${diff === 0 ? 'Kas cocok' : `Selisih ${diff > 0 ? '+' : ''}${rp(diff)}`}</b><span class="muted">${sum.count} transaksi · ${rp(sum.total)}</span></div>`,
        foot: `<button class="btn ghost" data-pr>${icon('printer', 'sm')} Cetak laporan</button><button class="btn" data-close>Selesai</button>`,
      });
      $('[data-pr]', done.el).addEventListener('click', () => printHTML(shiftHTML(closed, sum, { branch: b, settings: settings() }), { paper: b.paper, title: 'Laporan shift' }));
      await done.result;
      logout(true);
    });
  }

  await render();
  const off = [bus.on('orders', render), bus.on('cashMoves', render)];
  return () => off.forEach((f) => f());
}
