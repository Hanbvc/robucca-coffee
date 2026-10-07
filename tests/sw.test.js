/* Semua berkas aplikasi POS harus masuk daftar cache service worker agar bisa dibuka offline,
   dan semuanya harus ikut ter-commit (tidak tertahan .gitignore) agar ikut ter-deploy. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../server/data-loader.js';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const posDir = path.join(ROOT, 'pos');
function shellList() {
  const src = fs.readFileSync(path.join(posDir, 'sw.js'), 'utf8');
  return JSON.parse(`[${/const SHELL = \[([\s\S]*?)\];/.exec(src)[1].replace(/'/g, '"').replace(/,\s*$/, '')}]`);
}

test('daftar SHELL service worker lengkap & semua berkasnya ada', () => {
  const shell = shellList();
  const files = walk(posDir).map((f) => path.relative(posDir, f).split(path.sep).join('/'))
    .filter((f) => /\.(js|css|html|webmanifest)$/.test(f) && f !== 'sw.js' && !f.startsWith('README'));
  for (const f of files) assert.ok(shell.includes(f), `${f} belum ada di SHELL pos/sw.js`);
  for (const s of shell) if (s !== './') assert.ok(fs.existsSync(path.resolve(posDir, s)), `${s} di SHELL tidak ditemukan`);
});

test('semua berkas aplikasi tidak tertahan .gitignore (ikut ter-deploy)', (t) => {
  let ignored;
  try {
    ignored = execFileSync('git', ['status', '--ignored', '--porcelain', '--', 'pos', 'menu', 'server', 'js', 'css', 'assets', 'tests', 'index.html', 'manifest.webmanifest', 'package.json'], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) { t.skip('bukan repositori git'); return; }
  const lines = ignored.split('\n').filter((l) => l.startsWith('!!'));
  assert.deepEqual(lines, [], `Berkas aplikasi diabaikan git (tidak akan ter-commit/ter-deploy):\n${lines.join('\n')}`);
  // berkas yang dimuat browser harus terlacak git (bukan hanya ada di folder kerja)
  const tracked = new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'pos', 'js', 'assets'], { cwd: ROOT, encoding: 'utf8' }).split('\n'));
  for (const s of shellList()) {
    if (s === './') continue;
    const rel = path.relative(ROOT, path.resolve(posDir, s)).split(path.sep).join('/');
    assert.ok(tracked.has(rel), `${rel} tidak terlacak git`);
  }
});
