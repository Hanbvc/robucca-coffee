/* Perangkat kasir/dapur yang terhubung ke server pusat: pasangkan & cabut akses. */
import { S, can } from '../../state.js';
import { $, esc, icon, modal, toast, confirmBox } from '../../lib/ui.js';
import { dateTime, ago } from '../../core/dates.js';
import { pageHead, myBranches, branchName } from './common.js';

export async function mount(el) {
  if (!S.be.isServer) {
    el.innerHTML = `${pageHead('Perangkat', 'Kasir, tablet dapur, dan komputer kantor yang terhubung ke server pusat')}
      <div class="page"><div class="card pad" style="max-width:720px">
        <h3 class="card-title">${icon('cloud', 'sm')} Perangkat ini dalam mode demo</h3>
        <p style="margin:0 0 10px;color:var(--ink-2)">Di mode demo semua data hanya ada di browser ini, jadi cabang lain tidak bisa melihatnya. Untuk dipakai sungguhan di semua cabang:</p>
        <ol style="margin:0 0 12px;padding-left:20px;color:var(--ink-2);line-height:1.7">
          <li>Jalankan server pusat (<code>npm start</code>) di komputer/VPS yang bisa diakses semua cabang — lihat <b>pos/README.md</b>.</li>
          <li>Buka alamat server di komputer kantor, pasangkan dengan kode yang tampil di konsol server, lalu masuk sebagai pemilik.</li>
          <li>Di Kantor › Perangkat, buat kode pasang untuk setiap kasir & tablet dapur di tiap cabang.</li>
        </ol>
        <p class="hint">Setiap perangkat menyimpan transaksi sendiri saat internet putus dan mengirimnya ke server begitu online.</p>
      </div></div>`;
    return;
  }
  const mine = myBranches();
  let rows = [];
  async function load() {
    rows = await S.be.devices();
    const now = Date.now();
    el.innerHTML = `${pageHead('Perangkat', 'Kasir, tablet dapur, dan komputer kantor yang terhubung ke server', `<button class="btn sm" data-new>${icon('plus', 'sm')} Pasangkan perangkat</button>`)}
      <div class="page"><div class="table-card"><div class="table-scroll"><table class="table"><thead><tr><th>Perangkat</th><th>Cabang</th><th>Terminal</th><th>Dipasang</th><th>Terakhir online</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.map((d) => `<tr><td><b>${esc(d.name)}</b>${d.id === S.be.device.id ? ' <span class="tag blue">perangkat ini</span>' : ''}</td><td>${d.branchId ? esc(branchName(d.branchId)) : '<span class="tag dark">Kantor pusat</span>'}</td>
        <td>${d.branchId ? `T${d.terminalNo}` : '—'}</td><td class="n">${d.createdAt ? dateTime(d.createdAt) : '—'}</td>
        <td>${d.lastSeen ? `${ago(now - d.lastSeen)} lalu` : '—'}</td>
        <td>${d.revoked ? '<span class="tag red">Dicabut</span>' : d.lastSeen && now - d.lastSeen < 120000 ? '<span class="tag green"><span class="dot"></span>Online</span>' : '<span class="tag">Offline</span>'}</td>
        <td class="r">${!d.revoked && d.id !== S.be.device.id ? `<button class="btn danger ghost xs" data-revoke="${d.id}">Cabut akses</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="muted" style="text-align:center;padding:28px">Belum ada perangkat.</td></tr>'}
      </tbody></table></div></div>
      <p class="hint" style="margin-top:12px">Nomor terminal dipakai di nomor struk (mis. IJN<b>2</b>-…) agar tiap kasir di cabang yang sama punya urutan sendiri.</p></div>`;
  }
  function pairDialog() {
    const opts = [...(can('office.all') ? [{ id: '', name: 'Kantor pusat (laporan & pengaturan saja)' }] : []), ...mine];
    const nextNo = (bid) => Math.max(0, ...rows.filter((d) => d.branchId === bid && !d.revoked).map((d) => d.terminalNo || 0)) + 1;
    const m = modal({
      title: 'Pasangkan perangkat baru', size: 'sm',
      body: `<div class="col">
        <label class="field"><span>Untuk</span><select class="select" id="d-b">${opts.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Nama perangkat</span><input class="input" id="d-n" value="Kasir" placeholder="mis. Kasir depan, Tablet bar"></label>
        <label class="field" id="d-tw"><span>Nomor terminal</span><input class="input" id="d-t" type="number" min="1" max="26" value="${nextNo(opts[0].id)}"></label>
        <p class="err-text" id="d-e" hidden></p></div>`,
      foot: '<button class="btn ghost" data-close>Batal</button><button class="btn" data-ok>Buat kode pasang</button>',
    });
    const sync = () => { const bid = $('#d-b', m.el).value; $('#d-tw', m.el).hidden = !bid; $('#d-t', m.el).value = nextNo(bid); };
    sync();
    $('#d-b', m.el).addEventListener('change', sync);
    $('[data-ok]', m.el).addEventListener('click', async () => {
      const branchId = $('#d-b', m.el).value || null; const name = $('#d-n', m.el).value.trim() || 'Kasir'; const terminalNo = +$('#d-t', m.el).value || 1;
      if (branchId && rows.some((d) => d.branchId === branchId && d.terminalNo === terminalNo && !d.revoked) && !(await confirmBox({ title: `Terminal ${terminalNo} sudah dipakai`, text: 'Dua perangkat dengan nomor terminal sama bisa menghasilkan nomor struk ganda. Lanjutkan hanya bila perangkat lama sudah tidak dipakai (cabut aksesnya).', ok: 'Tetap lanjut' }))) return;
      try {
        const r = await S.be.createPairing({ branchId, name, terminalNo });
        m.close();
        modal({
          title: 'Kode pasang', sub: `${esc(name)} · ${branchId ? `${esc(branchName(branchId))} · Terminal ${terminalNo}` : 'Kantor pusat'}`, size: 'sm',
          body: `<div class="code-box">${esc(r.code)}</div>
            <ol style="margin:14px 0 0;padding-left:20px;line-height:1.7;color:var(--ink-2)"><li>Di perangkat baru, buka <b>${esc(S.be.device.serverUrl)}/pos/</b></li><li>Pilih <b>Hubungkan ke server pusat</b></li><li>Masukkan kode di atas</li></ol>
            <p class="hint" style="margin-top:10px">Kode berlaku sampai ${dateTime(r.expiresAt)} dan hanya bisa dipakai sekali.</p>`,
          foot: '<button class="btn" data-close>Selesai</button>',
        }).result.then(load);
      } catch (e) { const er = $('#d-e', m.el); er.textContent = e.message; er.hidden = false; }
    });
  }
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-new]')) pairDialog();
    const rv = e.target.closest('[data-revoke]');
    if (rv) {
      const d = rows.find((x) => x.id === rv.dataset.revoke);
      if (!(await confirmBox({ title: `Cabut akses ${d.name}?`, text: 'Perangkat tidak bisa lagi mengirim/menarik data. Data yang belum terkirim di perangkat itu tidak akan masuk ke server.', ok: 'Cabut akses', danger: true }))) return;
      try { await S.be.revokeDevice(d.id); toast('Akses perangkat dicabut', 'warn'); load(); } catch (er) { toast(er.message, 'err'); }
    }
  });
  await load();
}
