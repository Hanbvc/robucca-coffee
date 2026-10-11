/* Buat kode pasang perangkat dari server (untuk perangkat pertama, sebelum ada dasbor):
     DATABASE_URL=… node dist/cli/pair.js --branch IJN --terminal 1 --name "Kasir 1"
     DATABASE_URL=… node dist/cli/pair.js --office --name "Laptop pemilik"   (komputer kantor pusat) */
import { parseArgs } from 'node:util';
import { createPrismaClient } from '@robucca/db';
import { randDigits } from '@robucca/core';
import { sha256 } from '../common/tokens';

const PAIRING_TTL_MS = 15 * 60_000;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { branch: { type: 'string' }, terminal: { type: 'string' }, name: { type: 'string' }, office: { type: 'boolean', default: false } },
  });
  const db = createPrismaClient();
  try {
    const office = !!values.office;
    const branch = office ? null : await db.branch.findUnique({ where: { code: String(values.branch ?? '').toUpperCase() } });
    if (!office && !branch) throw new Error('Cabang tidak ditemukan. Pakai --branch KODE atau --office');
    const terminalNo = office ? Number(values.terminal ?? 0) : Number(values.terminal ?? 1);
    const branchId = branch?.id ?? null;
    const code = randDigits(6);
    const existing = await db.device.findFirst({ where: { branchId, terminalNo } });
    const data = { name: values.name ?? (office ? 'Kantor pusat' : `Kasir ${terminalNo}`), pairingCodeHash: sha256(code), pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS), revokedAt: null, tokenHash: null };
    if (existing) await db.device.update({ where: { id: existing.id }, data });
    else await db.device.create({ data: { branchId, terminalNo, ...data } });
    console.log(`Kode pasang: ${code}  (${office ? 'kantor pusat' : `${branch!.code} terminal ${terminalNo}`}, berlaku 15 menit)`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
