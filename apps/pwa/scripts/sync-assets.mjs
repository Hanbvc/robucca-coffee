/* Foto menu, logo, dan layar pembuka dipakai bersama dengan aplikasi lama & POS: <repo>/assets.
   Salin ke public/assets agar ikut disajikan Next (dev) dan masuk ke hasil ekspor (out/). Folder hasil salinan tidak di-commit. */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../assets');
const dst = resolve(here, '../public/assets');
let copied = 0;
for (const d of ['img', 'brand', 'splash']) {
  const from = join(src, d);
  if (!existsSync(from)) continue;
  mkdirSync(join(dst, d), { recursive: true });
  for (const f of readdirSync(from)) {
    const a = join(from, f);
    const b = join(dst, d, f);
    const s = statSync(a);
    if (!s.isFile()) continue;
    if (existsSync(b) && statSync(b).mtimeMs >= s.mtimeMs && statSync(b).size === s.size) continue;
    cpSync(a, b);
    copied++;
  }
}
if (copied) console.log(`aset: ${copied} file disalin ke public/assets`);
