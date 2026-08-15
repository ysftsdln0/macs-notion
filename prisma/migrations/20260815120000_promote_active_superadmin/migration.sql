-- Bir önceki `promote_superadmin` migration'ı en eski ADMIN'i yükseltirken
-- `isActive` filtresi taşımıyordu. Kulüpte dönem değiştiği için en eski ADMIN
-- pekâlâ pasife alınmış kurucu olabilir — hedeflenen kitle tam olarak odur.
--
-- Pasif bir SUPERADMIN sistemi kilitler: `has()` pasif aktöre hiçbir izin
-- vermez (policy.ts'teki mutlak kural), başka SUPERADMIN olmadığı için
-- `member:updateRole` kimseye açılmaz, ve `member:reactivate` bir ADMIN'in
-- SUPERADMIN'i geri etkinleştirmesini reddeder. Sonuç: /admin/roles kalıcı
-- olarak erişilemez, kurtarma yalnızca sunucuda psql ile mümkün.
--
-- Bu migration ÖNCEKİNİ DÜZENLEMEZ. Uygulanmış bir migration'ı değiştirmek
-- checksum sapması yaratır ve halihazırda göç etmiş her veritabanını
-- (geliştirme ve test dahil) `migrate deploy` yapamaz hale getirir. Düzeltme
-- bu yüzden yeni bir migration olarak eklenir.
--
-- ETKİSİZDİR eğer sistemde zaten aktif bir SUPERADMIN varsa — ki normal
-- kurulumda öyledir.
UPDATE "User" SET "globalRole" = 'SUPERADMIN'
WHERE id = (
  SELECT id FROM "User"
  WHERE "globalRole" = 'ADMIN' AND "isActive" = true
  ORDER BY "joinedAt" ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM "User" WHERE "globalRole" = 'SUPERADMIN' AND "isActive" = true
);
