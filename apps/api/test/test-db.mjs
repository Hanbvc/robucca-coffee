/* Database tes per berkas: turunan TEST_DATABASE_URL dengan akhiran (mis. "<nama>_office"), dibuat bila belum ada,
   agar berkas tes yang berjalan paralel (node --test) tidak saling bentrok saat migrasi & seed. */
export function derivedDb(suffix, override) {
  if (override) return { url: override, name: null, admin: null };
  const src = process.env.TEST_DATABASE_URL;
  if (!src) return null;
  const u = new URL(src);
  const name = `${u.pathname.replace(/^\//, '')}${suffix}`;
  u.pathname = `/${name}`;
  return { url: u.toString(), name, admin: src };
}

export async function ensureDb(target) {
  if (!target?.name) return;
  const { createPrismaClient } = await import('@robucca/db');
  const admin = createPrismaClient(target.admin);
  const exists = await admin.$queryRawUnsafe('SELECT 1 FROM pg_database WHERE datname = $1', target.name);
  if (!exists.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${target.name.replace(/"/g, '')}"`);
  await admin.$disconnect();
}
