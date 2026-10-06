/* Membaca js/data.js (skrip browser aplikasi pelanggan) tanpa menjalankannya di halaman:
   dievaluasi di sandbox `vm` dengan objek `window` kosong. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadCustomerData(file = path.join(ROOT, 'js', 'data.js')) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file, timeout: 2000 });
  const w = ctx.window;
  if (!Array.isArray(w.MG_MENU)) throw new Error(`MG_MENU tidak ditemukan di ${file}`);
  // salin keluar dari konteks vm agar menjadi objek biasa
  return JSON.parse(JSON.stringify({ MENU: w.MG_MENU, GROUPS: w.MG_GROUPS || [], CONFIG: w.MG_CONFIG || {} }));
}
