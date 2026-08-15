-- Role.position unique DEĞİL: sıralamayı değiştiren bir arayüz yok ve kısıt
-- aşağıdaki sabit pozisyonlu INSERT'i engelliyordu.
DROP INDEX "Role_position_key";

-- Kulübün örgüt şemasındaki kademeler. Daha önce `prisma/seed.ts` içindeki
-- `seedSystemRoles` ile kuruluyorlardı, ama `compose.yml`'de seed adımı yok:
-- canlıya çıkan sistem sıfır rolle açılırdı. Migration olarak `migrate` job'ı
-- her deploy'da çalıştırdığı için roller kendiliğinden oluşur.
--
-- Tanımlar BURADA tek kaynaktır; TypeScript'teki kopya silindi. İkisini birden
-- tutmak, zamanla birbirlerinden ayrılmaları demekti.
--
-- Rol YÖNETİMİ bilerek bir izin değil, SUPERADMIN kapısıdır — izinleri dağıtan
-- yetkinin kendisi ayarlanabilir olsaydı, onu taşıyan herkes kendine her şeyi
-- yazabilirdi.
--
-- `ON CONFLICT (slug) DO NOTHING`: geliştirme veritabanlarında bu roller
-- `seedSystemRoles` ile zaten oluşmuş olabilir, o durumda migration sessizce
-- geçer ve panelden yapılmış izin ayarlarını EZMEZ.
INSERT INTO "Role" (id, name, slug, color, permissions, "isSystem", position, "createdAt")
VALUES
  (
    'sysrole_yonetim_kurulu', 'Yönetim Kurulu', 'yonetim-kurulu', '#2563eb',
    ARRAY[
      'CONTENT_READ_ALL', 'CONTENT_WRITE_ALL',
      'BUDGET_READ_ALL', 'BUDGET_WRITE_ALL',
      'MEMBER_MANAGE', 'INVITE_MANAGE',
      'CHANNEL_CREATE', 'CHANNEL_MANAGE_ALL', 'TRASH_MANAGE'
    ]::"Permission"[],
    true, 1, NOW()
  ),
  (
    'sysrole_genel_sekreter', 'Genel Sekreter', 'genel-sekreter', '#7c3aed',
    ARRAY['CONTENT_READ_ALL', 'INVITE_MANAGE', 'TRASH_MANAGE']::"Permission"[],
    true, 2, NOW()
  ),
  (
    'sysrole_insan_kaynaklari', 'İnsan Kaynakları', 'insan-kaynaklari', '#059669',
    ARRAY['MEMBER_MANAGE', 'INVITE_MANAGE']::"Permission"[],
    true, 3, NOW()
  )
ON CONFLICT (slug) DO NOTHING;
