-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "channelId" TEXT;

-- CreateIndex
CREATE INDEX "Activity_channelId_idx" ON "Activity"("channelId");
