-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "description" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "slug" VARCHAR(60);

-- AlterTable
ALTER TABLE "OrganizationSetting" ADD COLUMN     "tiktok" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

