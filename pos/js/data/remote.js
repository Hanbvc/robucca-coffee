/* Klien HTTP ke server pusat + aliran event (SSE lewat fetch agar bisa membawa header otorisasi). */

export class Remote {
  constructor({ url, token = '' }) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.token = token;
    this.session = null;
    this.stopped = false;
  }

  async call(method, path, body, { session = false, etag = null, timeout = 15000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const headers = {};
      if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (session && this.session) headers['X-Session'] = this.session;
      if (etag) headers['If-None-Match'] = `"${etag}"`;
      const res = await fetch(this.url + path, {
        method, headers, body: body != null ? JSON.stringify(body) : undefined, signal: ctrl.signal, cache: 'no-store',
      });
      if (res.status === 304) return { notModified: true };
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = new Error(data.error || `Server menolak permintaan (HTTP ${res.status})`);
        e.status = res.status; e.data = data;
        throw e;
      }
      return data;
    } catch (e) {
      if (e.status) throw e;
      const x = new Error(e.name === 'AbortError' ? 'Server tidak merespons' : 'Tidak terhubung ke server');
      x.offline = true;
      throw x;
    } finally {
      clearTimeout(t);
    }
  }

  /** Aliran event server (text/event-stream). onEvent({ type, data }), onState(online) */
  stream(onEvent, onState) {
    let delay = 2000;
    const run = async () => {
      if (this.stopped) return;
      const ctrl = new AbortController(); this.streamCtrl = ctrl;
      try {
        const res = await fetch(`${this.url}/api/stream`, { headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' }, signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok || !res.body) throw Object.assign(new Error('stream'), { status: res.status });
        onState(true); delay = 2000;
        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            let type = 'message'; let data = '';
            chunk.split('\n').forEach((ln) => {
              if (ln.startsWith('event:')) type = ln.slice(6).trim();
              else if (ln.startsWith('data:')) data += ln.slice(5).trim();
            });
            if (type !== 'ping') { try { onEvent({ type, data: data ? JSON.parse(data) : {} }); } catch (e) { /* abaikan event rusak */ } }
          }
        }
      } catch (e) {
        if (e.status === 401) { onEvent({ type: 'revoked', data: {} }); return; }
      }
      if (this.stopped) return;
      onState(false);
      setTimeout(run, delay); delay = Math.min(delay * 2, 30000);
    };
    run();
  }

  stop() { this.stopped = true; if (this.streamCtrl) this.streamCtrl.abort(); }
}
