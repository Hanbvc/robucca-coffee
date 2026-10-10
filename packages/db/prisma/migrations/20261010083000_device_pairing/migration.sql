-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "pairingCodeHash" TEXT,
ADD COLUMN     "pairingExpiresAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "Device_pairingCodeHash_key" ON "Device"("pairingCodeHash");

