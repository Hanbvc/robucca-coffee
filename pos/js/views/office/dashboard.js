/* Dasbor kantor: ringkasan penjualan, tren, cabang, jam ramai, metode bayar, produk terlaris. */
import { S, master, today, tzOf } from '../../state.js';
import { $, esc, icon } from '../../lib/ui.js';
import { rp, num, short } from '../../core/money.js';
import { prevRange, dateShort, dateLabel, rangeLabel, clock, ago, dayDiff, parts } from '../../core/dates.js';
import { columnChart, hbarsHTML, tableHTML } from '../../components/charts.js';
import { filterBar, wireFilters, range, branchIds, scopeLabel, pageHead, demoNote, branchName } from './common.js';
import { bus } from '../../data/bus.js';

/** Nilai kartu KPI: lengkap bila muat, ringkas (Rp281,4 jt) bila panjang; nilai lengkap di tooltip */
const money = (v) => { const full = rp(v); return full.length <= 12 ? full : `<span title="${full}">${v < 0 ? '-' : ''}Rp${short(Math.abs(v))}</span>`; };

function delta(cur, prev, upGood = true, vs = 'vs periode sebelumnya') {
  if (!prev) return '<div class="k-delta flat"><span>tanpa data pembanding</span></div>';
  const d = (cur - prev) / Math.abs(prev);
  const pct = Math.round(d * 1000) / 10;
  if (Math.abs(pct) < 0.1) return `<div class="k-delta flat">0% <span>${vs}</span></div>`;
  const good = d > 0 === upGood;
  return `<div class="k-delta ${good ? 'up' : 'down'}">${icon(d > 0 ? 'arrow-up' : 'arrow-down', 'xs')}${Math.abs(pct).toLocaleString('id-ID')}% <span>${vs}</span></div>`;
}

/** Hari ini masih berjalan → bandingkan dengan kemarin sampai jam yang sama, bukan seharian penuh */
function partialPrev(prev, upToHour) {
  const hs = prev.hours.filter((h) => h.hour <= upToHour);
  const sum = (k) => hs.reduce((a, h) => a + (h[k] || 0), 0);
  const orders = sum('orders');
  return { total: sum('total'), orders, items: sum('items'), net: sum('net'), discount: sum('discount'), avg: orders ? Math.round(sum('salesTotal') / orders) : 0 };
}

export async function mount(el) {
  let cleanups = [];
  el.innerHTML = `<div id="d-head"></div><div class="page" id="d-page"><div class="empty"><div class="spinner" style="margin:0 auto"></div></div></div>`;
  const page = $('#d-page', el);
  let seq = 0;
  const tableMode = {};

  async function load() {
    const my = ++seq;
    const r = range(); const p = prevRange(r); const ids = branchIds();
    $('#d-head', el).innerHTML = pageHead('Dasbor', `${esc(scopeLabel())} · ${esc(rangeLabel(r))}`, `<button class="btn ghost sm" data-refresh>${icon('rotate', 'sm')} Muat ulang</button>`);
    const fb = $('.filters', page); if (fb) fb.outerHTML = filterBar(); // pilihan baru langsung terlihat selama memuat
    page.classList.add('loading');
    const [cur, prev, status] = await Promise.all([
      S.be.report({ ...r, branchIds: ids }),
      S.be.report({ ...p, branchIds: ids }),
      (!ids || ids.length > 1) && master().activeBranches().length > 1 ? S.be.branchStatus().catch(() => null) : Promise.resolve(null),
    ]);
    if (my !== seq) return;
    page.classList.remove('loading');
    render(cur, prev, r, status);
  }

  function render(cur, prev, r, status) {
    cleanups.forEach((f) => f()); cleanups = [];
    const single = r.from === r.to;
    const live = single && r.from === today();
    const k = cur.kpi;
    const pk = live ? partialPrev(prev, parts(Date.now(), tzOf(S.be.device.branchId)).H) : prev.kpi;
    const vs = live ? 'vs kemarin s.d. jam ini' : single ? 'vs hari sebelumnya' : 'vs periode sebelumnya';
    const multi = cur.branches.length > 1 || (!branchIds() && master().activeBranches().length > 1);
    // deret waktu: per jam (1 hari) atau per hari
    let series;
    if (single) {
      const used = cur.hours.map((h, i) => (h.total || (prev.hours[i] || {}).total ? i : -1)).filter((i) => i >= 0);
      const lo = Math.min(7, ...used); const hi = Math.max(21, ...used);
      series = cur.hours.slice(lo, hi + 1).map((h) => ({ label: String(h.hour).padStart(2, '0'), full: `Pukul ${String(h.hour).padStart(2, '0')}.00–${String(h.hour).padStart(2, '0')}.59`, value: h.total, prev: (prev.hours[h.hour] || {}).total || 0 }));
    } else {
      series = cur.days.map((d, i) => ({ label: dateShort(d.date), full: dateLabel(d.date), value: d.total, prev: (prev.days[i] || {}).total || 0 }));
    }
    const hourRows = cur.hours.filter((h) => h.hour >= 6 && h.hour <= 23);
    const days = dayDiff(r.from, r.to) + 1;
    page.innerHTML = `${filterBar()}${demoNote()}
      <div class="kpis">
        <div class="kpi hero"><div class="k-label">Omzet${multi ? ' semua cabang terpilih' : ''}</div><div class="k-value">${rp(k.total)}</div>${delta(k.total, pk.total, true, vs)}<div class="k-sub">Bersih ${rp(k.net)} (tanpa pajak & servis)${k.refundTotal ? ` · refund ${rp(k.refundTotal)}` : ''}</div></div>
        <div class="kpi"><div class="k-label">Transaksi</div><div class="k-value">${num(k.orders)}</div>${delta(k.orders, pk.orders, true, vs)}</div>
        <div class="kpi"><div class="k-label">Rata-rata per transaksi</div><div class="k-value">${money(k.avg)}</div>${delta(k.avg, pk.avg, true, vs)}</div>
        <div class="kpi"><div class="k-label">Item terjual</div><div class="k-value">${num(k.items)}</div>${delta(k.items, pk.items, true, vs)}</div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="k-label">Diskon diberikan</div><div class="k-value">${money(k.discount)}</div>${delta(k.discount, pk.discount, false, vs)}</div>
        <div class="kpi"><div class="k-label">Pajak (PB1)</div><div class="k-value">${money(k.tax)}</div><div class="k-sub">${k.service ? `Biaya layanan ${rp(k.service)}` : 'tanpa biaya layanan'}</div></div>
        <div class="kpi"><div class="k-label">Void</div><div class="k-value">${num(k.voids)}</div><div class="k-sub">${rp(k.voidTotal)} dibatalkan</div></div>
        <div class="kpi"><div class="k-label">Rata-rata omzet harian</div><div class="k-value">${money(Math.round(k.total / days))}</div><div class="k-sub">${days} hari</div></div>
      </div>
      <div class="dash-grid">
        <section class="chart-card ${multi ? 'span-8' : 'span-12'}">
          <header><div><h3>Tren omzet ${single ? 'per jam' : 'per hari'}</h3><p>Batang = periode ini · garis abu = periode sebelumnya</p></div>
            <div class="right"><div class="legend"><span><i class="box" style="background:var(--viz-accent)"></i>Periode ini</span><span><i style="background:var(--viz-muted)"></i>Sebelumnya</span></div><button class="btn ghost xs" data-tbl="trend">${tableMode.trend ? 'Grafik' : 'Tabel'}</button></div></header>
          <div class="viz" id="c-trend"></div>
        </section>
        ${multi ? `<section class="chart-card span-4"><header><div><h3>Omzet per cabang</h3><p>${esc(rangeLabel(r))}</p></div></header>${hbarsHTML(cur.branches.map((b) => ({ label: b.name, value: b.total })), { fmt: rp })}</section>` : ''}
        <section class="chart-card span-6">
          <header><div><h3>Jam ramai</h3><p>Total omzet per jam selama periode — untuk mengatur jadwal staf</p></div><div class="right"><button class="btn ghost xs" data-tbl="hours">${tableMode.hours ? 'Grafik' : 'Tabel'}</button></div></header>
          <div class="viz" id="c-hours"></div>
        </section>
        <section class="chart-card span-6"><header><div><h3>Metode pembayaran</h3><p>Nominal & porsi</p></div></header>${hbarsHTML(cur.payments.filter((x) => x.amount > 0).map((x) => ({ label: x.name, value: x.amount })), { fmt: rp })}</section>
        <section class="chart-card span-6"><header><div><h3>Menu terlaris</h3><p>Berdasarkan omzet</p></div><div class="right"><a class="btn ghost xs" href="#/kantor/laporan">Semua menu</a></div></header>
          ${cur.items.length ? `<table class="table"><thead><tr><th>#</th><th>Menu</th><th class="r">Terjual</th><th class="r">Omzet</th></tr></thead><tbody>
            ${cur.items.slice(0, 10).map((it, i) => `<tr><td class="n muted">${i + 1}</td><td>${esc(it.name)}<span class="sub">${esc((master().cat[it.catId] || {}).name || '')}</span></td><td class="r">${num(it.qty)}</td><td class="r">${rp(it.amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Belum ada penjualan.</p>'}
        </section>
        <section class="chart-card span-6"><header><div><h3>Tipe pesanan</h3><p>Dine in, take away, & ojol</p></div></header>${hbarsHTML(cur.channels.filter((x) => x.total > 0).map((x) => ({ label: x.name, value: x.total })), { fmt: rp })}
          <h3 style="margin:18px 0 10px;font-size:14.5px">Kategori</h3>${hbarsHTML(cur.categories.filter((x) => x.amount > 0).slice(0, 8).map((x) => ({ label: x.name, value: x.amount })), { fmt: rp })}</section>
        ${status ? `<section class="table-card span-12"><div class="row" style="padding:14px 16px 8px"><h3 style="margin:0;font-size:14.5px">Kondisi cabang hari ini</h3><span class="muted" style="font-size:12px">${esc(dateLabel(today(), true))}</span></div>
          <div class="table-scroll"><table class="table"><thead><tr><th>Cabang</th><th class="r">Omzet hari ini</th><th class="r">Transaksi</th><th class="r">Tagihan terbuka</th><th>Shift kasir</th><th>Aktivitas terakhir</th></tr></thead><tbody>
          ${status.filter((s) => !branchIds() || branchIds().includes(s.branchId)).map((s) => `<tr><td><b>${esc(branchName(s.branchId))}</b></td><td class="r">${rp(s.total)}</td><td class="r">${num(s.orders)}</td><td class="r">${num(s.openBills)}</td>
            <td>${s.openShifts ? `<span class="tag green"><span class="dot"></span>${s.openShifts} terbuka</span>` : '<span class="tag">Tutup</span>'}</td>
            <td>${s.lastActivity ? `${clock(s.lastActivity, (master().branch[s.branchId] || {}).tz)} · ${ago(Date.now() - s.lastActivity)} lalu` : '<span class="muted">—</span>'}${s.lastSeen ? `<span class="sub">perangkat terakhir online ${ago(Date.now() - s.lastSeen)} lalu</span>` : ''}</td></tr>`).join('')}
          </tbody></table></div></section>` : ''}
      </div>`;
    const trend = $('#c-trend', page);
    if (tableMode.trend) trend.innerHTML = tableHTML([{ label: single ? 'Jam' : 'Tanggal', get: (d) => d.full }, { label: 'Periode ini', r: true, get: (d) => rp(d.value) }, { label: 'Sebelumnya', r: true, get: (d) => rp(d.prev) }], series);
    else cleanups.push(columnChart(trend, { data: series, fmt: rp }));
    const hrs = $('#c-hours', page);
    const hourSeries = hourRows.map((h) => ({ label: String(h.hour).padStart(2, '0'), full: `Pukul ${String(h.hour).padStart(2, '0')}.00`, value: h.total }));
    if (tableMode.hours) hrs.innerHTML = tableHTML([{ label: 'Jam', get: (d) => d.full }, { label: 'Omzet', r: true, get: (d) => rp(d.value) }, { label: 'Transaksi', r: true, get: (d) => num(cur.hours[+d.label].orders) }], hourSeries);
    else cleanups.push(columnChart(hrs, { data: hourSeries, fmt: rp, height: 200 }));
  }

  wireFilters(el, load);
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-refresh]')) load();
    const t = e.target.closest('[data-tbl]'); if (t) { tableMode[t.dataset.tbl] = !tableMode[t.dataset.tbl]; load(); }
  });
  await load();
  const offs = [bus.on('orders', () => { if (!S.be.isServer) load(); })];
  return () => { cleanups.forEach((f) => f()); offs.forEach((f) => f()); };
}
