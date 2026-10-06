/* Semua berkas aplikasi POS harus masuk daftar cache service worker agar bisa dibuka offline. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/data-loader.js';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test('daftar SHELL service worker lengkap & semua berkasnya ada', () => {
  const posDir = path.join(ROOT, 'pos');
  const src = fs.readFileSync(path.join(posDir, 'sw.js'), 'utf8');
  const shell = JSON.parse(`[${/const SHELL = \[([\s\S]*?)\];/.exec(src)[1].replace(/'/g, '"').replace(/,\s*$/, '')}]`);
  const files = walk(posDir).map((f) => path.relative(posDir, f).split(path.sep).join('/'))
    .filter((f) => /\.(js|css|html|webmanifest)$/.test(f) && f !== 'sw.js' && !f.startsWith('README'));
  for (const f of files) assert.ok(shell.includes(f), `${f} belum ada di SHELL pos/sw.js`);
  for (const s of shell) if (s !== './') assert.ok(fs.existsSync(path.resolve(posDir, s)), `${s} di SHELL tidak ditemukan`);
});
