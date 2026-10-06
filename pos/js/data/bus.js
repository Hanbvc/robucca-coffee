/* Event sederhana + siaran antar-tab (BroadcastChannel) agar layar Kasir, Dapur,
   dan Antrean yang terbuka di tab berbeda pada perangkat yang sama ikut diperbarui. */

const handlers = new Map();
let chan = null;
try { chan = new BroadcastChannel('robucca-pos'); } catch (e) { chan = null; }

function fire(type, data) {
  (handlers.get(type) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
  (handlers.get('*') || []).forEach((fn) => { try { fn(type, data); } catch (e) { console.error(e); } });
}

if (chan) chan.onmessage = (e) => { if (e.data && e.data.type) fire(e.data.type, { ...(e.data.data || {}), remote: true }); };

export const bus = {
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push(fn);
    return () => handlers.set(type, (handlers.get(type) || []).filter((f) => f !== fn));
  },
  /** Kirim ke tab ini dan (bila `share`) ke tab lain */
  emit(type, data = {}, share = true) {
    fire(type, data);
    if (share && chan) { try { chan.postMessage({ type, data }); } catch (e) { /* data tidak bisa diklon */ } }
  },
};
