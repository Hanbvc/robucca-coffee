/* Server statis kecil untuk mencoba hasil ekspor (out/) secara lokal: node scripts/serve.mjs [port].
   Menghormati NEXT_PUBLIC_BASE_PATH seperti saat build. Untuk produksi pakai hosting statis biasa. */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../out');
const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
const port = Number(process.argv[2] ?? process.env.PORT ?? 3001);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.webp': 'image/webp',
};

if (!existsSync(root)) {
  console.error('Folder out/ belum ada. Jalankan "pnpm build" dulu.');
  process.exit(1);
}

createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  if (base) {
    if (!p.startsWith(base)) {
      res.writeHead(302, { location: `${base}/` }).end();
      return;
    }
    p = p.slice(base.length) || '/';
  }
  let file = normalize(join(root, p));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) file = join(root, '404.html');
  const ok = !file.endsWith('404.html') || p.endsWith('404.html');
  res.writeHead(ok ? 200 : 404, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': file.includes('/_next/static/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Aplikasi pelanggan: http://localhost:${port}${base}/`));
