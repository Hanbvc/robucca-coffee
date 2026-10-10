/* Pengiriman OTP di produksi: tanpa webhook → masuk WhatsApp dimatikan (503); dengan webhook → kode dikirim ke gateway,
   tidak pernah ada di respons; gateway gagal → 502 dan kode dihapus.
   Database: OTP_TEST_DATABASE_URL, atau turunan TEST_DATABASE_URL dengan nama "<nama>_otp" (dibuat otomatis, migrasi saja). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivedDb, ensureDb } from './test-db.mjs';

const target = derivedDb('_otp', process.env.OTP_TEST_DATABASE_URL);
const URL_ = target?.url;
const here = path.dirname(fileURLToPath(import.meta.url));
const api = path.resolve(here, '..');
const dbPkg = path.resolve(here, '../../../packages/db');
const skip = !URL_ && 'TEST_DATABASE_URL belum diisi';
const SECRET = 'tes-rahasia-yang-panjangnya-lebih-dari-32-karakter';

let gateway; let gatewayUrl; let gatewayStatus = 200;
const received = [];
const servers = [];
let db;

async function startApi(port, extra) {
  const env = { ...process.env, NODE_ENV: 'production', DATABASE_URL: URL_, AUTH_SECRET: SECRET, PORT: String(port), ...extra };
  const p = spawn('node', ['dist/main.js'], { cwd: api, env, stdio: 'ignore' });
  servers.push(p);
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return `http://127.0.0.1:${port}`; } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('API tidak menyala');
}

const post = async (base, p, body) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

before(async () => {
  if (!URL_) return;
  await ensureDb(target);
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: dbPkg, env: { ...process.env, DATABASE_URL: URL_ }, stdio: 'ignore' });
  gateway = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      received.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      res.writeHead(gatewayStatus).end('{}');
    });
  });
  await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
  gatewayUrl = `http://127.0.0.1:${gateway.address().port}/kirim`;
  const { createPrismaClient } = await import('@robucca/db');
  db = createPrismaClient(URL_);
});

after(async () => {
  for (const s of servers) s.kill();
  gateway?.close();
  await db?.$disconnect();
});

const PORT = 3400 + Math.floor(Math.random() * 50);
const phone = `0813${String(Date.now()).slice(-8)}`;
const e164 = `62${phone.slice(1)}`;

test('produksi tanpa webhook: masuk WhatsApp dimatikan, config.otpLogin false', { skip }, async () => {
  const base = await startApi(PORT, { OTP_WEBHOOK_URL: '' });
  assert.equal((await (await fetch(`${base}/public/config`)).json()).otpLogin, false);
  const r = await post(base, '/public/auth/otp', { phone });
  assert.equal(r.status, 503);
  assert.match(r.body.message, /tamu/);
  assert.equal(await db.customerOtp.count({ where: { phone: e164 } }), 0);
});

test('produksi dengan webhook: kode dikirim ke gateway (bukan di respons) lalu bisa dipakai; gateway gagal → 502', { skip }, async () => {
  const base = await startApi(PORT + 50, { OTP_WEBHOOK_URL: gatewayUrl, OTP_WEBHOOK_SECRET: 'rahasia-gateway' });
  assert.equal((await (await fetch(`${base}/public/config`)).json()).otpLogin, true);
  const r = await post(base, '/public/auth/otp', { phone });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.devCode, undefined, 'produksi tidak pernah mengembalikan kode');
  const sent = received.at(-1);
  assert.equal(sent.auth, 'Bearer rahasia-gateway');
  assert.equal(sent.body.phone, e164);
  assert.match(sent.body.code, /^\d{6}$/);
  assert.ok(sent.body.message.includes(sent.body.code));
  const v = await post(base, '/public/auth/verify', { phone, code: sent.body.code, name: 'Tes Gateway' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.ok(v.body.token);

  gatewayStatus = 500;
  const fail = await post(base, '/public/auth/otp', { phone });
  assert.equal(fail.status, 502);
  assert.equal(await db.customerOtp.count({ where: { phone: e164 } }), 0, 'kode yang gagal terkirim tidak disimpan');
});
