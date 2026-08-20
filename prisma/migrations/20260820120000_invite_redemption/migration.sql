-- 1. Kullanımlar için yeni tablo
CREATE TABLE "InviteRedemption" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "userId" TEXT,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    CONSTRAINT "InviteRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InviteRedemption_inviteId_userId_key" ON "InviteRedemption"("inviteId", "userId");
CREATE INDEX "InviteRedemption_inviteId_reservedAt_idx" ON "InviteRedemption"("inviteId", "reservedAt");

ALTER TABLE "InviteRedemption" ADD CONSTRAINT "InviteRedemption_inviteId_fkey"
  FOREIGN KEY ("inviteId") REFERENCES "Invite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InviteRedemption" ADD CONSTRAINT "InviteRedemption_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Kullanılmış davetler taşınır. Bu adım kolonlar DÜŞMEDEN ÖNCE olmalı.
--    id için cuid üretemeyiz; davet id'sinden türeyen deterministik bir metin
--    yeterli (davet başına en fazla bir eski kullanım var).
INSERT INTO "InviteRedemption" ("id", "inviteId", "userId", "reservedAt", "redeemedAt")
SELECT 'mig_' || md5("id"), "id", "usedByUserId", "usedAt", "usedAt"
FROM "Invite"
WHERE "usedAt" IS NOT NULL AND "usedByUserId" IS NOT NULL;

-- 3. İptal kalıcı olmaktan çıkar, veri korunur
ALTER TABLE "Invite" RENAME COLUMN "revokedAt" TO "disabledAt";

-- 4. Yeni alanlar. Mevcut davetlerin hepsi tek kullanımlıktı; NULL (= sınırsız)
--    anlamı yeni satırlara ait olsun diye backfill'den sonra DEFAULT bırakılmaz.
ALTER TABLE "Invite" ADD COLUMN "label" TEXT;
ALTER TABLE "Invite" ADD COLUMN "maxUses" INTEGER;
UPDATE "Invite" SET "maxUses" = 1;

-- 5. Süresiz davet mümkün olsun
ALTER TABLE "Invite" ALTER COLUMN "expiresAt" DROP NOT NULL;

-- 6. Taşınan kolonlar düşer (FK ve indeksleri kendileriyle birlikte gider)
ALTER TABLE "Invite" DROP COLUMN "usedByUserId";
ALTER TABLE "Invite" DROP COLUMN "usedAt";
ALTER TABLE "Invite" DROP COLUMN "reservedAt";
