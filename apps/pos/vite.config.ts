import type { IncomingMessage, ServerResponse } from 'node:http';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
/** Foto menu & logo dipakai bersama dengan aplikasi lama/PWA: <repo>/assets (imageUrl seed = "assets/img/<id>.jpg"). */
const ASSETS = resolve(here, '../../assets');
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

/** Sajikan /assets/* dari folder aset repo saat dev/preview, dan salin ke dist saat build. */
function sharedAssets(): Plugin {
  let outDir = '';
  const serve = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
    const m = /\/assets\/((?:img|brand)\/.+)$/.exec(url);
    if (!m) {
      next();
      return;
    }
    const file = normalize(join(ASSETS, m[1]!));
    if (!file.startsWith(ASSETS) || !existsSync(file) || !statSync(file).isFile()) {
      next();
      return;
    }
    res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'robucca-shared-assets',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
    closeBundle() {
      if (!outDir || !existsSync(outDir)) return;
      for (const d of ['img', 'brand']) cpSync(join(ASSETS, d), join(outDir, 'assets', d), { recursive: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here, '');
  // Dev/preview: /api/* diteruskan ke API NestJS (tanpa CORS). Alamat API: API_PROXY_TARGET, atau VITE_API_URL bila absolut.
  const target = env.API_PROXY_TARGET || (/^https?:\/\//.test(env.VITE_API_URL ?? '') ? env.VITE_API_URL! : 'http://localhost:3000');
  const proxy: Record<string, ProxyOptions> = {
    '/api': { target, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
  };
  return {
    // Path relatif agar hasil build bisa dimuat dari file:// di dalam Electron.
    base: './',
    plugins: [react(), tailwindcss(), sharedAssets()],
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
    build: { chunkSizeWarningLimit: 1200 },
  };
});
