/* Penyaji berkas statis aplikasi POS & menu pelanggan. Hanya folder yang diizinkan yang bisa diakses
   (database, kode server, dan berkas lain di repo tidak pernah disajikan). */
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const ALLOW = ['/pos/', '/menu/', '/assets/', '/js/data.js'];
const NO_CACHE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest']);

export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:", "connect-src 'self'", "frame-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'",
].join('; ');

export function serveStatic(root, req, res, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch (e) { return false; }
  if (p === '/pos' || p === '/menu') { res.writeHead(301, { Location: `${p}/` }); res.end(); return true; }
  if (p.endsWith('/')) p += 'index.html';
  const allowed = (x) => ALLOW.some((a) => (a.endsWith('/') ? x.startsWith(a) : x === a));
  if (p.includes('\0') || !allowed(p)) return false;
  const file = path.resolve(root, `.${p}`);
  // cek ulang setelah normalisasi (mencegah /pos/%2e%2e/server/…)
  const rel = `/${path.relative(root, file).split(path.sep).join('/')}`;
  if (!file.startsWith(root + path.sep) || !allowed(rel) || rel.split('/').some((s) => s.startsWith('.') && s.length > 1)) return false;
  let st;
  try { st = fs.statSync(file); } catch (e) { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers = {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    ETag: etag,
    'Cache-Control': NO_CACHE.has(ext) ? 'no-cache' : 'public, max-age=604800',
  };
  if (ext === '.html') headers['Content-Security-Policy'] = CSP;
  if (p === '/pos/sw.js') headers['Service-Worker-Allowed'] = '/pos/';
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}
