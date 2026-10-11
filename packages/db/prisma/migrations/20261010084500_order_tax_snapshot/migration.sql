-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "roundingMode" "RoundingMode" NOT NULL DEFAULT 'DOWN',
ADD COLUMN     "roundingUnit" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "taxOnService" BOOLEAN NOT NULL DEFAULT true;

