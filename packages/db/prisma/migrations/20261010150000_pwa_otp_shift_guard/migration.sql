-- CreateTable
CREATE TABLE "CustomerOtp" (
    "phone" VARCHAR(16) NOT NULL,
    "codeHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerOtp_pkey" PRIMARY KEY ("phone")
);


-- Satu shift OPEN per terminal (perangkat; Device unik per cabang + nomor terminal).
-- Prisma belum bisa menulis indeks parsial, jadi SQL ini ditulis tangan dan TIDAK tercermin di schema.prisma.
-- Kode tetap memeriksa lebih dulu (pesan yang ramah); indeks ini penjaga terakhir bila dua sinkron bersamaan.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Shift" WHERE "status" = 'OPEN' AND "deviceId" IS NOT NULL GROUP BY "deviceId" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Ada terminal dengan lebih dari satu shift OPEN. Tutup shift ganda dulu (dasbor Kantor > Shift), lalu jalankan migrasi lagi.';
  END IF;
END $$;

CREATE UNIQUE INDEX "Shift_one_open_per_device" ON "Shift" ("deviceId") WHERE "status" = 'OPEN' AND "deviceId" IS NOT NULL;
