-- Kurulum daveti ile giren ilk ADMIN, sistemin sahibidir. Bu adım atlanırsa
-- sistemde hiç SUPERADMIN kalmaz ve rol paneli kimseye açılmaz.
UPDATE "User" SET "globalRole" = 'SUPERADMIN'
WHERE id = (
  SELECT id FROM "User"
  WHERE "globalRole" = 'ADMIN'
  ORDER BY "joinedAt" ASC
  LIMIT 1
);
