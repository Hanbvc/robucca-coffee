/* =========================================================
   Penjaga layar pembuka (skrip biasa, sengaja ES5 agar jalan di browser lama).
   Bila aplikasi gagal dimuat — berkas tidak ditemukan, browser terlalu lama,
   atau penyimpanan diblokir — tampilkan pesan & tombol pemulihan, bukan
   loading yang berputar selamanya.
   ========================================================= */
(function () {
  var errors = [];
  var shown = false;

  function el(tag, text, css) {
    var e = document.createElement(tag);
    if (text) e.textContent = text;
    if (css) e.style.cssText = css;
    return e;
  }
  function resetAll() {
    var jobs = [];
    try { sessionStorage.clear(); } catch (e) { /* abaikan */ }
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('pos:') === 0) localStorage.removeItem(k); });
    } catch (e) { /* abaikan */ }
    if (window.indexedDB) {
      jobs.push(new Promise(function (res) {
        var r = indexedDB.deleteDatabase('robucca-pos');
        r.onsuccess = r.onerror = r.onblocked = function () { res(); };
        setTimeout(res, 3000);
      }));
    }
    if (window.caches) {
      jobs.push(caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.indexOf('robucca-pos') === 0; }).map(function (k) { return caches.delete(k); }));
      }).catch(function () {}));
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.map(function (r) { return r.scope.indexOf('/pos/') >= 0 ? r.unregister() : null; }));
      }).catch(function () {}));
    }
    Promise.all(jobs).then(function () { location.hash = ''; location.reload(); });
  }

  /** Ganti pemutar di layar pembuka dengan pesan kesalahan + tombol pemulihan */
  function show(title, detail) {
    if (shown || window.__posReady) return;
    var boot = document.getElementById('boot');
    var msg = document.getElementById('boot-msg');
    if (!boot || !msg) return;
    shown = true;
    var spin = boot.querySelector('.spinner');
    if (spin) spin.style.display = 'none';
    msg.textContent = '';
    msg.appendChild(el('b', title, 'display:block;font-size:17px;margin-bottom:8px'));
    msg.appendChild(el('span', detail, 'display:block;max-width:440px;line-height:1.5'));
    var info = errors.slice(0, 4).join(' · ');
    if (info) msg.appendChild(el('small', 'Rincian: ' + info, 'display:block;margin-top:10px;opacity:.75;font-size:11.5px;word-break:break-all;max-width:440px'));
    var row = el('div', '', 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:16px');
    var b1 = el('button', 'Muat ulang', 'height:44px;padding:0 18px;border-radius:12px;border:0;background:#FAEEDA;color:#01512C;font:600 14px Poppins,system-ui,sans-serif;cursor:pointer');
    b1.onclick = function () { location.reload(); };
    var b2 = el('button', 'Hapus data perangkat & muat ulang', 'height:44px;padding:0 18px;border-radius:12px;border:1.5px solid rgba(250,238,218,.5);background:transparent;color:#FAEEDA;font:600 14px Poppins,system-ui,sans-serif;cursor:pointer');
    b2.onclick = function () {
      if (window.confirm('Hapus semua data POS di perangkat ini (termasuk transaksi yang belum terkirim ke server)?')) resetAll();
    };
    row.appendChild(b1); row.appendChild(b2);
    msg.appendChild(row);
  }
  window.__posBootFail = function (detail) {
    show('Aplikasi gagal dibuka', detail || 'Terjadi kesalahan saat memuat aplikasi.');
  };

  // Browser tanpa dukungan modul JavaScript (sangat lama)
  if (!('noModule' in document.createElement('script'))) {
    document.addEventListener('DOMContentLoaded', function () {
      show('Browser terlalu lama', 'Perbarui browser (Chrome, Edge, atau Safari versi terbaru) lalu buka lagi halaman ini.');
    });
  }

  // Berkas skrip/gaya gagal dimuat, atau error sebelum aplikasi siap
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && t.tagName) {
      if (t.tagName !== 'SCRIPT' && t.tagName !== 'LINK') return;
      var url = t.src || t.href || '';
      errors.push('gagal memuat ' + url.split('/').slice(-3).join('/'));
      if (t.tagName === 'SCRIPT') show('Aplikasi gagal dimuat', 'Sebagian berkas aplikasi tidak bisa diunduh. Periksa koneksi internet lalu muat ulang. Bila baru saja diperbarui, tunggu beberapa menit.');
      return;
    }
    if (e.message) errors.push(e.message);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    errors.push(String((r && r.message) || r));
    if (!window.__posReady) show('Aplikasi gagal dibuka', 'Terjadi kesalahan saat memulai aplikasi.');
  });

  // Batas waktu: jangan biarkan pemutar berputar selamanya
  setTimeout(function () {
    if (!window.__posReady) show('Aplikasi belum terbuka', 'Pemuatan terlalu lama. Coba muat ulang. Bila tetap begini, browser mungkin memblokir penyimpanan situs (mode privat/pengaturan cookie) atau terlalu lama.');
  }, 25000);
})();
