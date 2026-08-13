# Roller ve İzinler — Tasarım

**Tarih:** 2026-08-13
**Durum:** Onaylandı
**Önceki:** [2026-08-07-macs-notion-design.md](./2026-08-07-macs-notion-design.md)

## Problem

Kulübün örgüt şeması üç kademeli:

```
Başkan
  └── Yönetim Kurulu (koordinatörler)
        ├── Proje · Sosyal Medya · İnsan Kaynakları
        ├── Genel Sekreter · Sponsorluk · Etkinlik & Organizasyon
        └── her koordinatörlüğün altında üyeler
```

Mevcut model bunun iki kademesini karşılıyor: koordinatörlük = `Channel`, koordinatör =
`channelRole: LEAD`, üye = `MEMBER`, Başkan = `globalRole: ADMIN`.

Karşılamadığı üç şey var:

1. **Yönetim Kurulu'nun kendisi.** "Tüm koordinatörlükleri gören kademe" diye bir şey yok.
   `budget:read`, LEAD'e yalnızca kendi kanalının bütçesini gösteriyor; kulüp geneline bakan
   bir katman yok. Tek çare herkesi ADMIN yapmak, o da yetkiyi ayırt edilemez hale getiriyor.
2. **Kademe isimleri.** `LEAD` / `MEMBER` dışında bir kademe tanımlanamıyor.
3. **İzinlerin ayarlanabilirliği.** Hangi kademenin neyi gördüğü koda gömülü; değiştirmek
   `policy.ts` düzenlemek demek.

## Yaklaşım: rol ve kanal, iki ayrı eksen

`Role` tablosu eklenir, `ChannelMember` **olduğu gibi kalır**. İki eksen iki ayrı soruyu
cevaplar:

| Eksen | Soru | Taşıyıcı |
|---|---|---|
| Kanal üyeliği | Hangi koordinatörlüktesin, orada koordinatör müsün | `ChannelMember` |
| Rol | Kulüpte hangi kademedesin, kulüp geneli hangi izinleri taşıyorsun | `Role` + `UserRole` |

"Sponsorluk Koordinatörü" bir rol **değildir** — sponsorluk kanalının `LEAD`'idir. Kanalın
kim olduğunu kanal söyler. "Yönetim Kurulu" bir roldür, çünkü hiçbir kanala bağlı değildir.

`can()` mevcut mantığını korur; rol izinleri üstüne **eklenir** (union). Mevcut kod ve testler
ayakta kalır.

### Değerlendirilip elenen yaklaşımlar

**Tam Discord modeli** (`ChannelRoleOverride`: rol × kanal × allow/deny + rol hiyerarşisi).
6 koordinatörlük ve ~50 kişi için override matrisi neredeyse hiç kullanılmaz; karşılığında
izin editörü, override ekranı ve `can()`'in baştan yazılması gelir. YAGNI.

**Rollerin her şeyi yutması** (`GlobalRole` ve `ChannelRole` silinir, kanal erişimi de
`RoleChannelGrant` üzerinden verilir). En temiz kavram modeli, en büyük göç: `Actor.memberships`,
davet akışı, `entity-access.ts` ve tüm policy testleri yeniden yazılır. Çalışan v1'i sallar.

## Veri modeli

```prisma
enum GlobalRole {
  SUPERADMIN   // sistem sahibi — dönem değişse de kalır
  ADMIN        // Başkan
  MEMBER
}

enum Permission {
  CONTENT_READ_ALL     // her koordinatörlüğün içeriği (PRIVATE dahil)
  CONTENT_WRITE_ALL
  BUDGET_READ_ALL
  BUDGET_WRITE_ALL
  MEMBER_MANAGE        // pasife al / geri aç
  INVITE_MANAGE        // davet üret / iptal
  CHANNEL_CREATE
  CHANNEL_MANAGE_ALL   // her koordinatörlüğün ayarı + üye listesi
  TRASH_MANAGE
}

model Role {
  id          String       @id @default(cuid())
  name        String       @unique   // "Yönetim Kurulu"
  slug        String       @unique
  color       String?                // rozet rengi
  permissions Permission[]
  isSystem    Boolean      @default(false)  // silinemez, adı değişmez
  position    Int          @unique   // rozet sıralaması
  createdAt   DateTime     @default(now())
  members     UserRole[]
}

model UserRole {
  id          String   @id @default(cuid())
  userId      String
  roleId      String
  grantedById String?
  grantedAt   DateTime @default(now())

  user      User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      Role  @relation(fields: [roleId], references: [id], onDelete: Cascade)
  grantedBy User? @relation("RoleGrantedBy", fields: [grantedById], references: [id], onDelete: SetNull)

  @@unique([userId, roleId])
  @@index([roleId])
}
```

### İzin kataloğu neden `enum`

Panelden ayarlanabilir olan, **rolün hangi izinleri taşıdığıdır** — izin kataloğunun kendisi
değil. Kodda o izni kontrol eden bir dal yoksa, o izin yalandır: kutucuk işaretlenir, hiçbir
şey değişmez. Yeni izin = migration + `policy.ts`'te bir dal, bilinçli bir iş.

### Sponsor izinleri neden yok

Sponsorlar `content:*` kurallarına tabi (`entity-access.ts:76-98`). `SPONSOR_READ_ALL`,
`CONTENT_READ_ALL`'ın kopyası olurdu — ayırt eden bir dal yok. Sponsor gizliliğini kanalın
`PRIVATE` olması sağlıyor.

## Kademeler

| | SUPERADMIN | ADMIN (Başkan) | Yönetim Kurulu rolü |
|---|---|---|---|
| Tüm içerik, bütçe, sponsor | ✓ | ✓ | ✓ |
| Üye pasife alma, davet | ✓ | ✓ | ✓ |
| Rol oluşturma / izin dağıtma | ✓ | ✗ | ✗ |
| Kimin ADMIN olacağı | ✓ | ✗ | ✗ |
| Pasife alınabilir mi | hayır | evet | evet |

**SUPERADMIN = sistem sahibi + Başkan (2 kişi).** Başkan her yıl değişir, sistemin sahibi
değişmez. Bir SUPERADMIN diğerini düşürebilir — devir teslim böyle yapılır — ama son aktif
SUPERADMIN düşürülemez.

**Rol yönetimi `ROLE_MANAGE` izni değil, `globalRole === 'SUPERADMIN'` kapısıdır.** İzinleri
dağıtan yetkinin kendisi ayarlanabilir bir izin olursa, o izni taşıyan herkes kendine her
şeyi yazabilir. Sistemi tanımlayan kural sistemin dışında durur. Bunun sonucu olarak rol
hiyerarşisi ve "kendinde olmayan izni veremezsin" kuralına gerek kalmaz: rol düzenleyebilen
tek aktör zaten her izne sahiptir.

Kurulumda gelen roller (`isSystem: true`):

| Rol | İzinler |
|---|---|
| Yönetim Kurulu | `CONTENT_READ_ALL`, `CONTENT_WRITE_ALL`, `BUDGET_READ_ALL`, `BUDGET_WRITE_ALL`, `MEMBER_MANAGE`, `INVITE_MANAGE`, `CHANNEL_CREATE`, `CHANNEL_MANAGE_ALL`, `TRASH_MANAGE` |
| İnsan Kaynakları | `MEMBER_MANAGE`, `INVITE_MANAGE` |
| Genel Sekreter | `CONTENT_READ_ALL`, `INVITE_MANAGE`, `TRASH_MANAGE` |

## Yönetime özel kanal

Yeni tablo gerekmez. Yönetim Kurulu rolü `CONTENT_READ_ALL` + `CONTENT_WRITE_ALL` taşıdığı
için, `PRIVATE` bir kanal zaten yönetime özel bir alandır:

| Kim | "Yönetim Kurulu" adlı PRIVATE kanal |
|---|---|
| SUPERADMIN / ADMIN | görür, yazar |
| YK rolü olan | görür, yazar — kanala üye eklenmesine gerek yok |
| Koordinatörlük üyesi | kanal listesinde bile yok |

Üye eklemeye gerek olmaması esas kazançtır: YK'ya yeni biri geldiğinde erişim kendiliğinden
açılır, ayrıldığında kapanır. Elle senkron tutulacak ikinci bir liste yoktur.

**Bilinçli kabul edilen sonuç:** `CONTENT_READ_ALL`, YK'ya *her* PRIVATE kanalı açar —
İnsan Kaynakları'nın üye görüşme notları dahil. İstisna mekanizması (`ChannelRoleGrant`)
bilinçli olarak eklenmedi.

## `policy.ts` entegrasyonu

`Actor` tek alan kazanır; `toActor` (`session.ts:13`) rolleri düzleştirir:

```ts
export type Actor = {
  id: string
  globalRole: GlobalRole
  isActive: boolean
  memberships: { channelId: string; channelRole: ChannelRole }[]
  permissions: Permission[]      // rollerin birleşimi — ZORUNLU alan
}

export function has(actor: Actor, permission: Permission): boolean {
  if (!actor.isActive) return false
  if (actor.globalRole !== 'MEMBER') return true   // SUPERADMIN + ADMIN her izni kapsar
  return actor.permissions.includes(permission)
}
```

ADMIN'in "her şey" anlamına gelmesi tek satırda durur. `can()` içindeki `isAdmin(actor)`
çağrıları ilgili izinle değişir:

```ts
case 'content:read':
  return resource.channelVisibility === 'OPEN' ||
    has(actor, 'CONTENT_READ_ALL') ||
    !!membership(actor, resource.channelId)

case 'budget:read':
  if (has(actor, 'BUDGET_READ_ALL')) return true
  return membership(actor, resource.channelId)?.channelRole === 'LEAD'
```

### `permissions` neden zorunlu alan

`collab/src/auth.ts:29-45` kendi `CollabActor`'ünü ayrı kurar ve `authorize-document.ts:54`
bunu `can()`'e `Actor` olarak geçirir. Alan opsiyonel olsaydı collab tarafı sessizce "hiç izni
yok" ile çalışırdı: Yönetim Kurulu üyesi dokümanı uygulamada açar, collab bağlantısı reddedilir.
Zorunlu alan `tsc --noEmit`'i her `Actor` kurulum noktasında hataya düşürür ve göçün kontrol
listesi haline gelir.

### İzin başına dokunulan yerler

`globalRole === 'ADMIN'` kontrolü `can()` dışında 20+ yerde ham olarak duruyor. İşin gövdesi
bunları izne çevirmektir.

| İzin | Yer |
|---|---|
| `CONTENT_READ_ALL` | `channels-query.ts:25`, `tasks-query.ts:49`, `events-query.ts:36`, `sponsors-query.ts:54`, `documents-query.ts:139`, `members/page.tsx:18,62`, `entity-access.ts:141` |
| `CONTENT_WRITE_ALL` | `policy.ts` (`content:write`, `content:delete`, `document:*`), `comments.ts:102` |
| `BUDGET_READ_ALL` / `BUDGET_WRITE_ALL` | `budget-query.ts:75`, `policy.ts` bütçe dalları |
| `TRASH_MANAGE` | `trash/page.tsx:15`, `documents-query.ts:187`, `documents.ts:111,130`, `tasks.ts:338`, `events.ts:153`, `sponsors.ts:201` |
| `INVITE_MANAGE` | `policy.ts` `invite:*` (→ `invites.ts`, `admin/page.tsx:31` otomatik) |
| `MEMBER_MANAGE` | `policy.ts` `member:deactivate` / `member:reactivate` |
| `CHANNEL_CREATE`, `CHANNEL_MANAGE_ALL` | `policy.ts` `channel:*` |

`member:updateRole` (kimin ADMIN olacağı) bilerek hiçbir izne bağlanmaz — `SUPERADMIN`'de
kalır. İK'ya üye pasife alma yetkisi vermek, ona Başkan üretme yetkisi vermek anlamına gelmemeli.

## Mevcut kodda düzeltilmesi zorunlu üç defekt

**1. `members.ts:45` yanlış havuzu koruyor.**

```ts
if (target.globalRole !== 'ADMIN' || !target.isActive) return
```

Üç değerli enum'da bu satır son SUPERADMIN'in pasife alınmasına izin verir; sistem rol
yönetimi yapılamaz halde kalır. Korunan havuz `SUPERADMIN`'e taşınır. ADMIN havuzunun sıfıra
düşmesi artık tehlikeli değildir — SUPERADMIN yeniden atar. Mevcut `runAdminGuardedChange`
(Serializable + `P2034`) sarmalayıcısı olduğu gibi kullanılır.

**2. `policy.ts` `Resource` hedefin rolünü taşımıyor.**

```ts
| { kind: 'member'; id: string }
```

`member:deactivate` yalnızca `isAdmin(actor) && resource.id !== actor.id` bakar; hedefin rolü
bilinmediği için **Başkan, SUPERADMIN'i pasife alabilir**. Resource `targetGlobalRole` alanı
kazanır; ADMIN yalnızca kendinden düşük kademeyi etkileyebilir.

**3. `invite-service.ts:82` kurulum akışını sessizce kırar.**

```ts
    if (invite.globalRole === 'ADMIN') {
      await tx.user.update({ where: { id: userId }, data: { globalRole: 'ADMIN' } })
    }
```

Tek bir enum değerini isimle kontrol ediyor. Üç değerli enum'da SUPERADMIN daveti yutulur:
davetli giriş yapar, `MEMBER` olarak açılır, sistemde hiç SUPERADMIN kalmaz. Seed'in
SUPERADMIN daveti üretmesi bu düzeltme olmadan tamamen etkisizdir. Kontrol
`invite.globalRole !== 'MEMBER'` olur ve davetin taşıdığı kademe olduğu gibi uygulanır.

## Arayüz

**Yeni dosyalar**

| Dosya | İş |
|---|---|
| `src/lib/permission-labels.ts` | `Permission` → Türkçe ad + açıklama (`activity-labels.ts` deseni) |
| `src/server/roles-query.ts` | `listRoles()`, `loadRole(id)` — `Actor` parametresi alır, `'use server'` **taşımaz** (`channels-query.ts:1-11` gerekçesi) |
| `src/server/roles.ts` | `createRole` · `updateRole` · `deleteRole` · `assignRole` · `unassignRole`, `defineAction` ile |
| `src/app/(app)/admin/roles/page.tsx` | Rol listesi: ad, renk, üye sayısı, izin sayısı |
| `src/app/(app)/admin/roles/[id]/page.tsx` | İzin editörü + rolün üyeleri |
| `src/components/roles/role-badge.tsx` | Renkli rozet |

**İzin editörü.** 9 kutucuk, üç grupta (İçerik / Para / Yönetim). Ham enum adı kullanıcıya
gösterilmez — "Tüm koordinatörlüklerin içeriğini görür" yazar.

**Rol atama.** `members/page.tsx:95`'teki `Rol` sütunu (`ADMIN ? 'Yönetici' : 'Üye'`)
rozetlere dönüşür; `MemberActions`'a çoklu rol seçimi eklenir. Rol atama tek yerde yapılır.

**Rozet nerede görünür:** üyeler tablosu ve üye profili. Yorum/atama/mention'a eklenmez.

**Durumlar.** `roles/page.tsx` ve `roles/[id]/page.tsx` yetkisizde `notFound()` çağırır →
**bu route'lara `loading.tsx` eklenmez** (`admin/page.tsx:25-28`: Suspense sınırı 200'ü
akıtıp durumu kilitliyor, yaşanmış defekt). Boş durum `EmptyState`, hata `defineAction`'ın
Türkçe mesajı.

**UI'da gizlemek yetkilendirme değildir.** Rol editörünü `notFound()` ile gizlemek yetmez;
`roles.ts` içindeki her eylem `defineAction`'ın `authorize` kancasından geçer.

## Göç

Üç ayrı migration, sıra zorunlu:

1. **`add_superadmin_enum_value`** — yalnız `ALTER TYPE "GlobalRole" ADD VALUE 'SUPERADMIN';`
   Postgres 16 bu komutu transaction içinde kabul eder ama **eklenen değeri aynı transaction'da
   kullanmaya izin vermez**. Prisma her migration dosyasını tek transaction'da çalıştırdığı
   için, veri güncellemesi aynı dosyada olursa migration `unsafe use of new value of enum type`
   ile patlar.
2. **`roles`** — `Permission` enum, `Role`, `UserRole` tabloları.
3. **`promote_superadmin`** — en eski ADMIN (kurulum daveti ile giren kişi) SUPERADMIN olur.
   Atlanırsa sistemde hiç SUPERADMIN kalmaz, rol paneli kimseye açılmaz.

Ardından `prisma/seed.ts`: kurulum daveti `SUPERADMIN` üretir, üç sistem rolü `isSystem: true`
ile eklenir. `Invite.globalRole` üç değerli olur; `create-invite-form.tsx` SUPERADMIN
seçeneğini yalnızca SUPERADMIN'e gösterir.

## Test

| Dosya | Kapsam |
|---|---|
| `tests/unit/policy.test.ts` (mevcut) | `permissions` zorunlu olunca tüm Actor kurulumları derlenmez → `makeActor()` fabrikası, sonra izin bazlı vakalar |
| `tests/unit/role-policy.test.ts` (yeni) | `has()` semantiği: SUPERADMIN/ADMIN kısa devresi, pasif aktörün hiçbir izni olmaması, izinsiz aktörün reddi |
| `tests/unit/budget-policy.test.ts`, `doc-policy.test.ts` (mevcut) | `BUDGET_*_ALL`, `CONTENT_*_ALL` dalları |
| `tests/integration/roles.test.ts` (yeni) | `createRole` / `updateRole` / `assignRole` SUPERADMIN dışına kapalı; ADMIN denemesi `FORBIDDEN` |
| `tests/integration/members.test.ts` (mevcut) | ADMIN SUPERADMIN'i pasife alamaz · SUPERADMIN diğerini düşürebilir · son aktif SUPERADMIN düşürülemez (`P2034` yarışı dahil) |
| `tests/e2e/authorization.spec.ts` (mevcut) | YK rolü olan yönetime özel PRIVATE kanalı görür ve yazar; düz üye listede bile göremez |
| `collab/` | `resolveActor` rolleri yükler; YK üyesi doküman soketine bağlanabilir |

En kritik test: **düz üyenin yönetim kanalını görememesi.** Diğer her şey yanlışsa fazla yetki
verilir; bu yanlışsa gizli içerik sızar.

## Kapsam dışı (bilinçli)

- **Davet üretirken rol seçme** (`Invite.roleId`). Rol, kişi girdikten sonra üyeler
  sayfasından atanır.
- **Kanal bazında rol istisnası** (`ChannelRoleGrant`). YK'nın her şeyi görmesi kabul edildi.
- **Rozetin her yerde görünmesi** (yorum, atama, mention). İstenen şey yetki; rozet dağıtmak
  ayrı bir iş.
