# Özelleştirilebilir Davet Bağlantıları — Tasarım

**Tarih:** 2026-08-19
**Durum:** Onaylandı
**İlgili:** [2026-08-13-roller-ve-izinler-design.md](./2026-08-13-roller-ve-izinler-design.md)

## Problem

Bugün davet üretmenin tek bir biçimi var: **tek kullanımlık, sabit 7 gün**.
`createInvite` (`src/server/invites.ts`) hiçbir süre/limit girdisi almaz,
`inviteExpiry()` (`src/lib/auth/invite-token.ts`) sabit `INVITE_TTL_DAYS = 7`
döner, form (`src/app/(app)/admin/create-invite-form.tsx`) yalnızca rol ve
kanal sorar.

Bu, kulübün gerçek davet işlerini karşılamıyor:

- **Tanıtım standı / duyuru gönderisi.** Otuz kişiye ulaşacak tek bir bağlantı
  gerekiyor; bugün otuz ayrı davet üretip tek tek dağıtmak gerekir.
- **Dar zamanlı davet.** Toplantı sırasında paylaşılan bir bağlantının bir gün
  sonra da çalışıyor olması istenmiyor; bugün her davet yedi gün yaşar.
- **Hangi link neydi.** Admin listesinde davetler yalnızca kanal adıyla görünür.
  Aynı kanala açılmış üç bekleyen davet birbirinden ayırt edilemez.
- **Geçici kapatma.** `revokeInvite` kalıcıdır, geri alınamaz. Çok kullanımlı bir
  bağlantıyı "şimdilik durdur, yarın devam" diye yönetmenin yolu yok.

Ek olarak, bugünkü veri modeli çok kullanımı **yapısal olarak** engelliyor:
`Invite` satırında tek bir `usedByUserId` / `usedAt` / `reservedAt` üçlüsü var.
Bunlar bir davetin ömrü boyunca **tek** bir kullanımı temsil eder.

## Kapsam

Formda üç ayar: **geçerlilik süresi**, **kullanım limiti**, **etiket**.
Devre dışı bırakma kalıcı iptal yerine **duraklat/devam** olur.

Kapsam **dışı** (bilinçli olarak): e-posta domain kısıtı. İstenirse ayrı bir iş.

## Çözüm A — Kullanımlar ayrı satırlara taşınır

`Invite` satırındaki tekil kullanım alanları yeni bir `InviteRedemption`
tablosuna taşınır. Böylece "kaç kişi kullandı" bir sayaç değil, sayılabilir bir
gerçek olur; "kim kullandı" çok kullanımlı davette de cevaplanabilir kalır.

```prisma
model Invite {
  id          String      @id @default(cuid())
  tokenHash   String      @unique
  globalRole  GlobalRole  @default(MEMBER)
  channelId   String?
  channelRole ChannelRole @default(MEMBER)

  label       String?     // "Bahar standı" — admin listesinde ayırt etmek için
  maxUses     Int?        // null = sınırsız
  expiresAt   DateTime?   // null = süresiz (ARTIK NULLABLE)
  disabledAt  DateTime?   // revokedAt'in yerine; kalıcı değil, TOGGLE

  createdById String?
  createdAt   DateTime    @default(now())

  channel     Channel?           @relation(...)
  createdBy   User?              @relation("InviteCreatedBy", ...)
  redemptions InviteRedemption[]

  @@index([expiresAt])
}

model InviteRedemption {
  id         String    @id @default(cuid())
  inviteId   String
  userId     String?   // rezervasyon anında null — kullanıcı henüz oluşmadı
  reservedAt DateTime  @default(now())
  redeemedAt DateTime?

  invite Invite @relation(fields: [inviteId], references: [id], onDelete: Cascade)
  user   User?  @relation("InviteRedeemedBy", fields: [userId], references: [id], onDelete: SetNull)

  @@unique([inviteId, userId])      // aynı kişi aynı linkte ikinci slot yakmaz
  @@index([inviteId, reservedAt])
}
```

`Invite`'tan **kaldırılanlar:** `usedByUserId`, `usedAt`, `reservedAt`,
`revokedAt`. `User.usedInvites` ilişkisi `User.inviteRedemptions`'a döner.

### Neden `usedAt` yerine ayrı satır

Sayaç alternatifi (`usedCount Int`) tek atomik `UPDATE … WHERE usedCount <
maxUses` ile yarışsız çalışırdı, ama rezervasyon TTL'i ile birlikte bozulur:
bugünkü akışta bir rezervasyon `createUser` hiç çalışmadan **serbest kalabilmek**
zorunda (bkz. `invite-service.ts` yorumları — adaptör hatası, ağ kopması,
kullanıcının Google ekranında vazgeçmesi). Sayaçta bu, "TTL dolunca sayacı geri
düş" telafi koduna dönüşür; hangi artışın hangi rezervasyona ait olduğunu sayaç
bilmediği için bu kod doğru yazılamaz. Satır tabanlı modelde TTL yalnızca sayım
sorgusunun `WHERE`'inde yaşar, telafi kodu hiç yazılmaz.

### `@@unique([inviteId, userId])` neyi korur

Postgres'te `NULL`'lar unique kısıtta çakışmaz, dolayısıyla **birden çok
`userId IS NULL` rezervasyon** aynı davet için yan yana durabilir — eşzamanlı
kayıt akışları için gereken tam olarak budur. Kısıt yalnızca `userId`
bağlandıktan sonra devreye girer ve aynı kullanıcının aynı bağlantıyla ikinci
bir slot yakmasını imkânsız kılar.

## Çözüm B — Kontenjan kapısı satır kilidiyle serileştirilir

Yarış: iki kişi aynı anda son slota gelirse ikisi de "kontenjan var" okur.
Sayım + ekleme ayrı ifadeler olduğu için `updateMany` deseni burada yetmez.

`claimInvite` transaction içinde önce `Invite` satırını kilitler:

```ts
await tx.$queryRaw`SELECT id FROM "Invite" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`
```

Kilit alındıktan sonra sırayla: davet var mı, `disabledAt IS NULL`,
`expiresAt IS NULL OR expiresAt > now`, ve **canlı kullanım** sayımı:

```
redeemedAt IS NOT NULL            -- kalıcı tüketim
OR reservedAt > now - TTL         -- uçuştaki rezervasyon
```

`maxUses IS NULL` ise kontenjan kontrolü hiç yapılmaz. Sayım `maxUses`'ın
altındaysa yeni bir redemption satırı açılır ve `redemptionId` döner.

Kilit `Invite` satırında olduğu için aynı davete gelen tüm eşzamanlı istekler
serileşir; farklı davetler birbirini beklemez. Kulüp ölçeğinde maliyeti ihmal
edilebilir.

`INVITE_RESERVATION_TTL_MS = 5 dakika` aynen korunur.

## Çözüm C — `createUser` kendi rezervasyonunu sahiplenir

Bugün `signIn` daveti rezerve eder, `createUser` event'i `applyInvite(invite.id,
user.id)` ile kalıcılaştırır. İkisi arasında paylaşılan tek durum çerezdeki
token. Çok kullanımda o token'a ait **birden çok** uçuşan rezervasyon olabilir,
dolayısıyla `createUser`'ın "kendi" satırını seçmesi gerekir.

Çerez sözleşmesi **değişmez** (token'a rezervasyon kimliği eklenmez — `signIn`
callback'i içinden çerez yazmak Auth.js akışında kırılgan bir varsayımdır).
Bunun yerine `applyInvite(inviteId, userId)` şu sırayı izler:

1. O davetin `userId IS NULL`, `redeemedAt IS NULL`, TTL içindeki **en eski**
   rezervasyonunu bul.
2. `updateMany({ where: { id, userId: null }, data: { userId, redeemedAt } })`
   — `count === 1` kazanır. Kaybeden bir kez daha dener (bir sonraki satır);
   uygun satır kalmazsa `CONFLICT` döner.
3. Aynı transaction içinde bugünkü etkiler: `globalRole !== 'MEMBER'` ise rol
   ataması, `channelId` varsa `channelMember.upsert`, `recordActivity`.

Adım 2'nin koşullu `updateMany`'si bugünkü `usedAt: null` korumasının aynısıdır
— sadece koruma `Invite` yerine redemption satırında.

Hata durumunda transaction hiç commit olmaz: rezervasyon `userId` bağlanmadan
kalır, TTL sonunda kendiliğinden serbestleşir. Davet yanmaz — bugünkü davranış.

`consumeInvite` (oturumu açık kullanıcı, ikinci kanala davet) claim + apply'ı
tek transaction'da yürütür ve `claimInvite`'ın döndürdüğü `redemptionId`'yi
**doğrudan** kullanır — arama adımına hiç girmez. Arama yalnızca `createUser`
yolunda gerekir, çünkü orada iki callback arasında taşınabilen tek durum
çerezdir. `applyInvite` bu yüzden `redemptionId`'yi opsiyonel alır: verilmişse
o satırı sahiplenir, verilmemişse adım 1'deki aramayı yapar. Kullanıcı bu daveti **zaten** kullanmışsa
`@@unique([inviteId, userId])` yakalar; bu durumda slot yakmadan `ok` döner
(idempotent — çift tık yeni kontenjan tüketmez).

## Çözüm D — Kademe daveti sertleştirilir

Kademe dağıtan davet (`globalRole !== 'MEMBER'`) çok kullanımlı ya da süresiz
**olamaz**:

- `maxUses === 1` zorunlu
- `expiresAt` zorunlu ve `≤ 24 saat`

Gerekçe roller spec'indeki kuralın devamı: davet, kademe dağıtmanın ikinci
kapısıdır. Sızan tek kullanımlık 24 saatlik bir ADMIN linki tek hesapla ve tek
günle sınırlı kalır; sınırsız olanı kalıcı bir arka kapıdır.

İki katman:

| Katman | Nerede | Ne yapar |
|---|---|---|
| Şema doğrulama | `createInvite` input'unda `superRefine` | Kuralı ihlal eden girdi `BAD_REQUEST` |
| Yetki | `createInvite` `authorize` | Bugünkü SUPERADMIN kapısı aynen kalır |
| Form | `create-invite-form.tsx` | Kademe seçilince süre/limit alanları kilitlenir, sebebi yazar |

Form kilidi **kolaylıktır**, kapı değildir — asıl kural sunucuda.

## Çözüm E — İptal, duraklat/devam olur

`revokedAt` → `disabledAt` (kolon rename). `revokeInvite` action'ı
`setInviteDisabled({ inviteId, disabled: boolean })` olur; `disabled: true`
`disabledAt = now()`, `false` `disabledAt = null` yazar.

Activity fiilleri: `invite.disabled` / `invite.enabled` eklenir.
`invite.revoked` **kaldırılmaz** — geçmiş kayıtların etiketi olarak kalır
(`src/lib/activity-labels.ts`).

Kullanılmış slotlar geri alınmaz: duraklatılmış bir davet devam ettirildiğinde
kalan kontenjanından devam eder.

## Çözüm F — Form ve liste

**Form** (`create-invite-form.tsx`) üç alan kazanır:

| Alan | Seçenekler | Varsayılan |
|---|---|---|
| Süre | 1 saat · 1 gün · 7 gün · 30 gün · Süresiz | 7 gün |
| Kullanım limiti | 1 kişi · 5 · 25 · Sınırsız | 1 kişi |
| Etiket | serbest metin, ≤ 60 karakter, opsiyonel | boş |

Süre seçenekleri `INVITE_DURATIONS` sabitinde (`invite-token.ts`) tek yerde
tanımlanır; `inviteExpiry(duration)` bunu alır. `INVITE_TTL_DAYS` sabiti
`DEFAULT_INVITE_DURATION`'a döner (seed ve CLI script'i bunu kullanır).

Limit 1'den büyük seçildiğinde "bir kez gösterilir" uyarısı vurgulanır —
kaybedilen çok kullanımlı bir bağlantı yeniden gösterilemez (aşağı bak).

**Liste** (`admin/page.tsx`) satır başına: `Etiket · Kanal · 3/25 kullanıldı ·
durum`, altında kullananların isimleri, sağda Duraklat/Devam butonu.

Durum hesabı `inviteStatus()` içinde şu sıraya döner: duraklatıldı → süresi
doldu → kontenjan doldu → bekliyor.

Sorgu `redemptions` ilişkisini `include` eder (`user: { select: { name } }`,
`redeemedAt` sıralı). Liste `take: 50`, davet başına kullanım sayısı küçük;
ayrı bir sayfalama gerekmez.

## Çözüm G — `/invite/[token]` sayfası

Bugünkü tekil `invite.usedAt` kontrolü yerine gerekçeli ayrım:

| Durum | Mesaj |
|---|---|
| Davet yok | "Bu bağlantı geçersiz." |
| `disabledAt` | "Bu davet şu anda kapalı. Kulüp yönetimine sor." |
| Süresi doldu | "Bu davetin süresi doldu." |
| Kontenjan doldu | "Bu davetin kontenjanı doldu." |
| Kullanıcı zaten kullanmış | "Bu daveti zaten kullandın." → `/` |

Render sırasında tüketmeme kuralı **korunur**: oturumu açık kullanıcı için
onay formu, prefetch'in daveti yakmaması için.

## Bilinçli olarak değiştirilmeyen: token yalnızca bir kez gösterilir

DB'de yalnızca `tokenHash` durur. Çok kullanımlı bir bağlantı kaybedilirse
tekrar gösterilemez; yenisi üretilir. Token'ı okunabilir saklamak, veritabanını
gören herkese kalıcı bir arka kapı verirdi. Karşılığında form uyarısı çok
kullanımlı davette daha görünür yapılır (Çözüm F).

## Migration

Tek migration, veri koruyarak, şu sırayla:

1. `InviteRedemption` tablosu + kısıtlar oluşturulur.
2. `usedAt IS NOT NULL` olan her davet için bir satır üretilir
   (`inviteId`, `userId = usedByUserId`, `reservedAt = usedAt`,
   `redeemedAt = usedAt`).
3. `Invite.revokedAt` → `disabledAt` rename (`ALTER TABLE … RENAME COLUMN`,
   veri korunur).
4. `Invite`'a `label`, `maxUses` eklenir. Mevcut davetler tek kullanımlıktı:
   `maxUses` backfill değeri **1**, sonra `DEFAULT` kaldırılır (yeni satırlarda
   `NULL` = sınırsız anlamlı kalsın diye).
5. `expiresAt` `DROP NOT NULL`.
6. `usedByUserId`, `usedAt`, `reservedAt` kolonları düşürülür.

Sıra önemli: 6 her zaman 2'den sonra.

## Test

| Seviye | Ne doğrulanır |
|---|---|
| Unit | `inviteExpiry(duration)` her seçenek için; `INVITE_DURATIONS` ↔ zod enum eşleşmesi |
| Integration | Kontenjan tükenince `claimInvite` reddeder; TTL geçmiş rezervasyon slotu geri verir; aynı kullanıcının ikinci `consumeInvite`'ı slot yakmaz; `disabled` davet reddedilir, devam ettirilince kabul edilir; süresiz davet 30 gün sonra da geçerli |
| Integration (yarış) | `maxUses: 1` davete **eşzamanlı** iki `claimInvite` → tam olarak biri kazanır (`FOR UPDATE` kilidinin asıl testi) |
| Integration (yetki) | ADMIN daveti `maxUses > 1` veya `expiresAt > 24s` ile reddedilir; MEMBER daveti kabul edilir |
| Integration (kayıt) | `registration-flow`: `signIn` → `createUser` sırası çok kullanımlı davette iki ayrı kullanıcı için çalışır |
| E2E | `invite-flow.spec`: etiketli, 2 kullanımlık davet üretilir; listede `0/2` görünür; duraklat/devam butonu durumu değiştirir |

## Dokunulan dosyalar

| Dosya | Değişiklik |
|---|---|
| `prisma/schema.prisma` + migration | Çözüm A, Migration |
| `src/server/invite-service.ts` | `claimInvite` kilit + kontenjan, `applyInvite` satır sahiplenme, `consumeInvite` idempotency |
| `src/server/invites.ts` | `createInvite` yeni girdiler + `superRefine`; `revokeInvite` → `setInviteDisabled` |
| `src/lib/auth/invite-token.ts` | `INVITE_DURATIONS`, `inviteExpiry(duration)`, `DEFAULT_INVITE_DURATION` |
| `src/lib/auth/config.ts` | `createUser` event'i `invite.usedByUserId` kontrolünü bırakır |
| `src/app/invite/[token]/page.tsx` | Gerekçeli geçersizlik ayrımı (Çözüm G) |
| `src/app/(app)/admin/create-invite-form.tsx` | Süre/limit/etiket alanları, kademe kilidi |
| `src/app/(app)/admin/page.tsx` | `redemptions` include, `x/y kullanıldı`, yeni durum sırası |
| `src/app/(app)/admin/revoke-invite-button.tsx` | Duraklat/Devam toggle'ına döner |
| `src/lib/activity-labels.ts` | `invite.disabled`, `invite.enabled` |
| `prisma/seed.ts`, `scripts/create-invite.ts` | Yeni alanlar, `DEFAULT_INVITE_DURATION` |
| Testler | Yukarıdaki tablo |
