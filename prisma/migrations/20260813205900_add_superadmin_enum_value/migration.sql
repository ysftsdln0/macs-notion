-- SUPERADMIN, ADMIN'in ÜSTÜNDE bir kademe; enum sırası bunu yansıtsın.
--
-- Bu migration BİLEREK yalnız bırakıldı. Postgres 16 `ALTER TYPE ... ADD VALUE`
-- komutunu transaction içinde kabul eder ama eklenen değeri AYNI transaction'da
-- kullanmaya izin vermez. Prisma her migration dosyasını tek transaction'da
-- çalıştırdığı için, bu dosyaya bir `UPDATE ... = 'SUPERADMIN'` eklenirse
-- migration `unsafe use of new value of enum type` hatasıyla patlar.
-- Veri güncellemesi ayrı bir migration'da (promote_superadmin) durur.
ALTER TYPE "GlobalRole" ADD VALUE 'SUPERADMIN' BEFORE 'ADMIN';
