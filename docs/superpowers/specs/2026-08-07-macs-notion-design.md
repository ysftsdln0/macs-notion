# MACS Notion — Tasarım Dokümanı (v1)

**Tarih:** 2026-08-07
**Durum:** Onaylandı, uygulama planı bekliyor
**Kapsam:** Bu doküman **v1'i** tam olarak tanımlar. v1.5 / v2 / v3 yalnızca yol haritası başlığı olarak yer alır; sırası geldiğinde her biri kendi tasarım dokümanını alır.

---

## 1. Amaç ve Bağlam

Öğrenci kulübü için iç koordinasyon aracı. Notion'un kulübe özel, sadeleştirilmiş hali.

**Çözdüğü iki somut dert:**

1. **Her şey WhatsApp'ta** — bilgi kayboluyor, kimin neyi yapacağı belli değil, karar geçmişi takip edilemiyor.
2. **Notion kullanılıyor ama ağır** — genel amaçlı olduğu için kulübün akışına oturmuyor, yeni üyeler kullanmıyor.

**Kullanıcılar:** ~30-100 kişi. Yönetim kurulu + alt ekipler (proje koordinatörlüğü, sponsorluk, medya, tasarım vb.).

**Bu bir dışa dönük site değildir.** Başvuru formu, halka açık etkinlik sayfası, tanıtım sitesi kapsam dışıdır.

### Başarı Kriteri

Kulübün etkinlik planlaması, görev takibi, karar arşivi ve sponsor/bütçe takibi WhatsApp ve Excel'den bu araca taşınır; bir dönem sonunda geçmiş kararlar ve kimin ne yaptığı geriye dönük okunabilir olur.

---

## 2. Kapsam Kararı: Neden "Notion Motoru" Değil

Notion'un kendisi = generic blok editör + kullanıcının tanımladığı database motoru (property tipleri, view tipleri, relation, rollup, formula, filtre motoru). Bu motorun kendisi tek başına bir üründür ve işin ~%70'ini yer.

**v1 bunun yerine sabit şema kullanır:** `Doküman`, `Görev`, `Etkinlik`, `Üye`, `Sponsor`, `Bütçe` varlıkları kodda tanımlıdır, her birinin arayüzü kendine özel tasarlanır. Sonuç: kulübün gerçek işleyişinde Notion'dan daha iyi bir arayüz, çok daha kısa sürede.

Generic motor v3'te gelir (bkz. Bölüm 10). v1'in veri deseni bunu engellemeyecek şekilde kurgulanmıştır.

**Bilinen risk (kayıt için):** v3 generic motoru, tek kişinin baktığı bir projede yol haritasının en riskli parçasıdır. Karar bilinçli alınmıştır; v1 ve v2 bağımsız olarak değer üretir ve v3 hiç yapılmasa da sistem eksik kalmaz.

---

## 3. Mimari

Tek Next.js uygulaması + yanında Yjs collab sunucusu. VPS üzerinde Docker Compose, önünde Caddy (otomatik HTTPS).

```
[Caddy :443]  ──/──────────►  [Next.js 15  :3000]  ──►  [Postgres 16]
              └─/collab/*──►  [Hocuspocus  :1234]  ──►  ┘  (Yjs doc state)
                                                        [uploads volume]
```

Dört container: `caddy`, `web`, `collab`, `db`. Geliştirme ortamı da aynı Compose dosyası ailesiyle ayağa kalkar.

### Teknoloji Seçimleri

| Katman | Seçim | Gerekçe |
|---|---|---|
| Framework | Next.js 15 (App Router), TypeScript strict | Server Component ile veri çekme, tek repo |
| UI | Tailwind CSS + shadcn/ui | Notion hissi için tam kontrol, responsive |
| Veritabanı | Postgres 16 + Prisma | Self-host, migration disiplini, tip güvenliği |
| Kimlik | Auth.js v5 + Google provider, DB session | Şifre yok, davet linki rol atar |
| Editör | BlockNote | Notion tarzı blok editör, Yjs desteği hazır |
| Realtime | Hocuspocus (Yjs sunucusu) | Auth hook'u var, doc state'i Postgres'e yazar |
| Dosya | Yerel volume + yetki kontrollü route | S3 yok; büyürse MinIO'ya geçilir |
| İstemci state | TanStack Query + minimum Zustand | Server state cache, client state az |
| Reverse proxy | Caddy | Otomatik HTTPS, tek satır config |
| Deploy | GH Actions → GHCR imaj → VPS `compose pull` | Push et, sunucu çeksin |
| Yedek | Gecelik `pg_dump` + uploads tar → offsite (rclone) | Tek kopya yedek değildir |

**Neden Supabase değil:** Self-host tercih edildi. Supabase self-host ~8 container ve bakımı tek kişiye kalıyor. Postgres + Prisma + Auth.js aynı işi 2 container'da yapar.

**Neden ayrı collab sunucusu:** Yjs kalıcı websocket bağlantısı ister; Next.js'in request/response modeline oturmaz. Ayrı container, aynı Postgres.

---

## 4. Veri Modeli

### Kimlik ve Organizasyon

```
User           id, name, avatarUrl, title, globalRole(ADMIN|MEMBER), isActive, joinedAt
Account        Auth.js — Google bağlantısı (userId, provider, providerAccountId)
Session        Auth.js — DB session
Invite         id, tokenHash, channelId?, globalRole, channelRole, expiresAt,
               usedByUserId?, usedAt, createdById, revokedAt
Channel        id, name, slug, icon, color, description,
               visibility(OPEN|PRIVATE), createdById, archivedAt
ChannelMember  channelId, userId, channelRole(LEAD|MEMBER)
```

**Kanal (Channel)** birincil organizasyon birimidir: hem sidebar'daki gezinme birimi hem de yetki kapsamı. Bir kullanıcı birden çok kanalda üye olabilir.

- `OPEN` kanal: içeriğini tüm kulüp okuyabilir, yazma yalnızca üyelerde.
- `PRIVATE` kanal: yalnızca üyeleri görür. Sponsorluk ve bütçe kanalları böyle açılır.
- Yeni kanal varsayılanı `OPEN`. Şeffaflık varsayılan, gizlilik istisna.
- Kanal açma yetkisi: herhangi bir kanalda `LEAD` olanlar + `ADMIN`.

### İçerik Varlıkları

```
Document       id, title, icon, parentId(self-ref, iç içe sayfa), channelId,
               visibility(PUBLIC|CHANNEL|PRIVATE), createdById, updatedAt, archivedAt
DocState       documentId, ydoc(bytea), updatedAt        // Hocuspocus yazar
DocumentShare  documentId, userId, permission(VIEW|EDIT)
Task           id, title, notes, status(BACKLOG|TODO|IN_PROGRESS|DONE),
               priority, dueDate, channelId, eventId?, createdById, rank, archivedAt
Assignee       taskId, userId                            // çoklu atama
Event          id, title, description, startsAt, endsAt, location,
               status(PLANNED|CONFIRMED|DONE|CANCELLED), channelId, coverUrl,
               createdById, archivedAt
Sponsor        id, name, logoUrl, contactName, contactEmail, contactPhone,
               status(PROSPECT|CONTACTED|NEGOTIATING|SIGNED|DECLINED),
               amount, currency, eventId?, ownerUserId, channelId, notes, archivedAt
BudgetEntry    id, kind(INCOME|EXPENSE), title, amount, currency, category, date,
               status(PLANNED|COMMITTED|PAID), eventId?, sponsorId?, channelId,
               receiptAttachmentId?, createdById, archivedAt
```

### Ortak Varlıklar

```
Comment        id, entityType, entityId, body, authorId, createdAt, editedAt, deletedAt
Attachment     id, fileName, mime, size, storagePath, entityType, entityId, uploadedById
Activity       id, actorId, verb, entityType, entityId, meta(jsonb), createdAt
Notification   id, userId, kind, entityType, entityId, actorId, readAt, createdAt
```

### Bilinçli Kararlar

- **Soft delete her yerde** (`archivedAt`) + Çöp Kutusu ekranı. Kulüpte biri mutlaka yanlışlıkla siler.
- **`rank` fractional index** (`0.5`, `0.75` …). Board'da sürükle-bırak tek satır update eder; tüm listeyi yeniden numaralamak yok.
- **`Activity` tablosu, "kim ne yaptı belli değil" derdinin doğrudan cevabıdır.** Ana sayfada akış olarak görünür.
- **Para `numeric(12,2)`** (Prisma `Decimal`). Float kullanılmaz — bütçede yuvarlama hatası kabul edilemez.
- **`Comment` ve `Attachment` polimorfik** (`entityType` + `entityId`). Veritabanı seviyesinde FK yoktur; bütünlüğü uygulama katmanı doğrular. Üç ayrı yorum tablosu yazmamak için bilinçli takas.
- **Arama:** Postgres full-text. İlgili tablolarda `tsvector` kolonu + GIN index. Ayrı arama servisi yok.
- **Davet token'ı DB'de hash'lenmiş saklanır** (ham token yalnızca linkte). 32 byte kriptografik rastgele.

---

## 5. Kimlik Doğrulama ve Yetkilendirme

### Giriş Akışı

1. Admin panelden davet üretir: kanal + rol seçer → tek kullanımlık, 7 gün geçerli link (`/invite/<token>`).
2. Kullanıcı linke tıklar → "Google ile devam et".
3. İlk girişte profil kurulumu: ad-soyad (Google'dan önden dolu, düzenlenebilir), ünvan, avatar.
4. Davet `usedByUserId` ile işaretlenir; ikinci kez çalışmaz. Admin daveti süresi dolmadan iptal edebilir (`revokedAt`).

Kullanıcı e-posta yazmaz; kimlik Google'dan gelir. Şifre yoktur, dolayısıyla şifre sıfırlama akışı da yoktur.

### Yetki Eksenleri

- **Global rol:** `ADMIN` (yönetim kurulu) | `MEMBER`
- **Kanal rolü:** `LEAD` | `MEMBER` (kanal başına)
- **Doküman görünürlüğü:** `PUBLIC` (tüm kulüp) | `CHANNEL` (kanal üyeleri) | `PRIVATE` (yazan + paylaşılan kişiler + admin)

### Yetki Matrisi

| Kaynak | Görme | Düzenleme | Silme |
|---|---|---|---|
| Doküman | `visibility` + `DocumentShare`'e göre | görebilenler (share'de `VIEW` ise hayır) | sahip, kanal `LEAD`, admin |
| Görev | kanal `visibility`'sine göre | kanal üyeleri + atanan kişi | kanal `LEAD`, admin |
| Etkinlik | kanal `visibility`'sine göre | kanal üyeleri | kanal `LEAD`, admin |
| Üye listesi | tüm kulüp (iletişim bilgisi hariç) | admin | admin |
| Sponsor | sponsorluk kanalı üyeleri + admin | aynı | admin |
| Bütçe | admin + ilgili kanal `LEAD` | admin | admin |
| Kanal / davet / rol | admin (kanal açma: `LEAD` de yapabilir) | admin | admin |

### Uygulama Kuralları

Yetki kontrolü tek bir yerde toplanır: `lib/auth/policy.ts` içinde `can(user, action, resource)`. Her server action ve her route handler bu fonksiyonu **veriye dokunmadan önce** çağırır.

Kontrolün yalnızca arayüzde yapılması yeterli değildir. Butonu gizlemek yetkilendirme değildir; endpoint doğrudan çağrılabilir. UI'daki gizleme kullanıcı deneyimi içindir, güvenlik sınırı değildir.

**Hocuspocus yetkilendirmesi ayrıca ele alınır.** Hocuspocus kendi başına yetki kontrolü yapmaz. `onAuthenticate` hook'u içinde Next.js oturum token'ı doğrulanır ve aynı `can()` fonksiyonu `document:edit` eylemi için çalıştırılır; yetkisiz bağlantı reddedilir. Bu yapılmazsa doküman ID'sini bilen herkes içeriği okuyabilir ve yazabilir, ana uygulamadaki tüm izinler baypas olur. Bu madde v1 için zorunludur ve testi Playwright akışlarına dahildir.

### Mahremiyet — Dürüst Sınırlar

`PRIVATE` doküman = yazan + açıkça paylaşılan kişiler + **admin**.

Bu nedenle arayüzde "Private" kelimesi kullanılmaz. Etiket **"Sadece ben"**, altında küçük not: *"Yöneticiler erişebilir."* Kod içinde enum `PRIVATE` olarak kalır.

Ayrıca: sunucuya erişimi olan kişi Postgres üzerinden tüm içeriği okuyabilir. Kullanıcılara "kimse göremez" güvencesi verilmez. Uçtan uca şifreleme arama ve canlı ortak düzenlemeyi imkânsız kılacağı için kapsam dışıdır.

### Üye Ayrılması

Admin bir üyeyi pasife aldığında (`isActive = false`):

- Kullanıcının `PRIVATE` dokümanları **admin'e devredilir**.
- Devir işlemi `Activity` tablosuna kayıt düşer.
- Kullanıcının oturumları sonlandırılır, yeniden giriş yapamaz.
- Atanmış görevleri atanmamış duruma düşer ve kanal `LEAD`'ine bildirim gider.

---

## 6. Ekranlar

| # | Ekran | İçerik |
|---|---|---|
| 1 | `/invite/[token]` → Google → profil kurulumu | Ad-soyad, ünvan, avatar |
| 2 | **Ana sayfa** | Bana atanan görevler · yaklaşan etkinlikler · aktivite akışı · sabitlenmiş dokümanlar |
| 3 | **Dokümanlar** | Sol ağaç (iç içe sayfa), BlockNote editör, canlı imleç + "kim burada", yorumlar, `@kişi` mention, paylaşım menüsü |
| 4 | **Görevler** | Board (durum kolonları, sürükle-bırak) + Liste görünümü; filtre: kanal / atanan / tarih; detay drawer |
| 5 | **Etkinlikler** | Takvim (ay/hafta) + liste; detay sayfasında bağlı görevler, bütçe kalemleri, sponsorlar, dokümanlar tek yerde |
| 6 | **Üyeler** | Tablo, kanal filtresi, profil sayfası (üye olduğu kanallar, açık görevleri) |
| 7 | **Sponsorlar** | Durum board'u (`PROSPECT` → `SIGNED`) + tablo; detayda iletişim geçmişi, tutar, bağlı etkinlik |
| 8 | **Bütçe** | Tablo + özet kartları (gelir / gider / bakiye), etkinlik bazlı kırılım, fiş eki |
| 9 | **Arama / ⌘K** | Global arama + komut paleti (yeni doküman, yeni görev, sayfaya git) |
| 10 | **Inbox** | Atama, mention, yorum bildirimleri — uygulama içi |
| 11 | **Admin** | Kanallar, davet üret/iptal, üye pasife al, çöp kutusu, Activity log |

**Gezinme:** Masaüstünde sol sidebar (üstte kişisel bağlantılar, altta "Kanallarım") + ⌘K komut paleti. Mobilde alt tab bar (Ana sayfa, Görevler, Etkinlik, Doküman, Diğer) + sidebar drawer.

**Responsive web yeterlidir; native mobil uygulama kapsam dışıdır.**

### v1'de Bilerek Yok

E-posta bildirimi · dışa dönük etkinlik sayfası · dosya önizleme · doküman sürüm geçmişi arayüzü · çoklu dönem arşivi · kanal içi sohbet (v1.5).

---

## 7. Hata Yönetimi

- Her server action `{ ok: true, data } | { ok: false, error }` döner. Exception fırlatıp arayüzde yakalama deseni kullanılmaz.
- Girdi doğrulama Zod ile; hata mesajları alan bazında forma döner.
- Her ekranda dört durum zorunludur: **yükleniyor** (skeleton) / **hata** (+ tekrar dene) / **boş** (+ eylem butonu) / **dolu**.
- Collab bağlantısı koptuğunda editörde "Bağlantı koptu, yeniden bağlanılıyor" bandı gösterilir. Yjs çevrimdışı düzenlemeye izin verir ve bağlantı dönünce değişiklikleri birleştirir.
- Sunucu tarafı yapılandırılmış log (pino) → dosya + `docker logs`. Hata izleme servisi (Sentry vb.) v1 kapsamında değildir.

---

## 8. Test

**Vitest (birim):**
- `policy.ts` yetki matrisi — her rol × her kaynak × her eylem. Projenin en kritik test kümesi.
- Fractional rank hesabı (sürükle-bırak sıralaması, sınır durumlar).
- Zod şemaları.

**Playwright (uçtan uca) — beş kritik akış:**
1. Davet linkiyle giriş ve profil kurulumu
2. Doküman oluştur → yaz → kalıcılığı doğrula
3. Görev sürükle-bırak ile durum değiştirme
4. Etkinliğe bütçe kalemi ve sponsor bağlama
5. **Yetkisiz erişimin reddi** — hem HTTP endpoint hem Hocuspocus websocket üzerinden

**CI:** `tsc --noEmit` + lint + tüm testler. Kırmızıysa imaj üretilmez.

---

## 9. Deploy ve İşletim

- `compose.yml`: `caddy`, `web`, `collab`, `db`. Geliştirme için `compose.dev.yml` aynı stack'i lokalde ayağa kaldırır.
- GitHub Actions: test → imaj build → GHCR push → VPS'te `compose pull && up -d`.
- `prisma migrate deploy` container başlangıcında çalışır.
- Domain mevcut; HTTPS Caddy tarafından otomatik. Google OAuth gerçek domain gerektirir, IP ile çalışmaz.
- **Yedekleme:** gecelik `pg_dump` + uploads dizini tar → offsite kopya (rclone). Geri yükleme en az bir kez elle denenir. Denenmemiş yedek yedek sayılmaz.

---

## 10. Yol Haritası

| Sürüm | Kapsam | Tahmin (tek kişi, part-time) |
|---|---|---|
| **v1** | Bu dokümandaki her şey | ~7-9 hafta |
| **v1.5** | Kanal içi sohbet (Slack tarzı: mesaj, thread, okundu, realtime, bildirim) | ~3-4 hafta |
| **v2** | Varlıklara admin tanımlı özel alanlar + generic "Liste" (text/sayı/tarih/select/kişi, tablo görünümü; relation/rollup/formula yok) | ~2-3 hafta |
| **v3** | Generic database motoru (property tipleri, view tipleri, filtre/sıralama motoru) | ~8+ hafta |

**Sohbet neden v1 değil v1.5:** Sohbet yarım yapılırsa WhatsApp'ı yenemez — bildirim, hız ve mobil beklentisi çok yüksektir. Kanal yapısı ise hemen değer üretir ve sohbet sonradan üstüne temiz oturur.

**v3'e giden yolu açık tutan tek tasarım kararı:** `Document`, `Task`, `Event`, `Sponsor`, `BudgetEntry` varlıklarının tümü `channelId` + `archivedAt` + `Activity` desenini paylaşır. v3'te bu varlıklar "sistem koleksiyonu" olarak generic motora şema tanımıyla bağlanır; veri taşınmaz. Böylece v3 yeniden yazma değil, üstüne ekleme olur.

---

## 11. Açık Uçlar

Yok. v1 kapsamındaki tüm kararlar alınmıştır. v1.5, v2 ve v3 sırası geldiğinde kendi tasarım dokümanlarını alacaktır.
