/* Klien HTTP ke API pusat (NestJS). Dipakai layar kasir dan (nanti) layar kantor.
   Header: X-Device-Token (perangkat terpasang) dan X-Session (sesi staf dari login PIN). */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: unknown = null,
  ) {
    super(message);
  }
}

/** Server tidak bisa dihubungi (jaringan putus, server mati, waktu habis). */
export class OfflineError extends Error {
  readonly offline = true;
}

export const isOffline = (e: unknown): e is OfflineError => e instanceof OfflineError;

export interface CallOptions {
  /** sertakan X-Session */
  session?: boolean;
  etag?: string | null;
  timeout?: number;
}

/** Alamat API bawaan: VITE_API_URL saat build, atau `/api` (proxy Vite) bila disajikan lewat http. */
export function defaultApiUrl(): string {
  const env = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/+$/, '');
  if (location.protocol === 'http:' || location.protocol === 'https:') return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}api`;
  return '';
}

/** Pesan galat dari NestJS: { message: string | string[] } */
function errorText(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const m = (data as { message: unknown }).message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string') return m;
  }
  return `Server menolak permintaan (HTTP ${status})`;
}

export class ApiClient {
  url: string;
  token: string;
  session: string | null = null;

  constructor({ url, token = '' }: { url: string; token?: string }) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.token = token;
  }

  headers(session = false): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.token) h['X-Device-Token'] = this.token;
    if (session && this.session) h['X-Session'] = this.session;
    return h;
  }

  async call<T = unknown>(method: string, path: string, body?: unknown, opts: CallOptions = {}): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeout ?? 15000);
    let res: Response;
    try {
      const headers = this.headers(!!opts.session);
      if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
      if (opts.etag) headers['If-None-Match'] = `"${opts.etag}"`;
      res = await fetch(this.url + path, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : null,
        signal: ctrl.signal,
        cache: 'no-store',
      });
    } catch (e) {
      throw new OfflineError((e as Error).name === 'AbortError' ? 'Server tidak merespons' : 'Tidak terhubung ke server');
    } finally {
      clearTimeout(t);
    }
    if (res.status === 304) return { notModified: true } as T;
    // Proxy dev (Vite) menjawab 502/504 saat API mati: anggap offline.
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new OfflineError('Server tidak bisa dihubungi');
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw new ApiError(errorText(data, res.status), res.status, data);
    return data as T;
  }

  get<T = unknown>(path: string, opts?: CallOptions) {
    return this.call<T>('GET', path, undefined, opts);
  }

  post<T = unknown>(path: string, body: unknown, opts?: CallOptions) {
    return this.call<T>('POST', path, body, opts);
  }

  /** Aliran event server (SSE). EventSource tidak bisa membawa header → token lewat query. */
  stream(path: string, onEvent: (type: string, data: unknown) => void, onState: (open: boolean) => void): () => void {
    let es: EventSource | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let delay = 2000;
    const open = () => {
      if (stopped) return;
      const sep = path.includes('?') ? '&' : '?';
      es = new EventSource(`${this.url}${path}${sep}device=${encodeURIComponent(this.token)}`);
      es.onopen = () => {
        delay = 2000;
        onState(true);
      };
      const handle = (type: string) => (e: MessageEvent<string>) => {
        let data: unknown = {};
        try {
          data = e.data ? JSON.parse(e.data) : {};
        } catch {
          /* abaikan event rusak */
        }
        onEvent(type, data);
      };
      for (const t of ['feed', 'master', 'order', 'message']) es.addEventListener(t, handle(t) as EventListener);
      es.onerror = () => {
        onState(false);
        // Tutup & buka ulang sendiri dengan jeda bertambah (EventSource bawaan berhenti bila server membalas 4xx).
        es?.close();
        if (!stopped) {
          retry = setTimeout(open, delay);
          delay = Math.min(delay * 2, 30000);
        }
      };
    };
    open();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }
}
