# Özelleştirilebilir Davet Bağlantıları — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Davet bağlantısı üretilirken geçerlilik süresi, kullanım limiti ve etiket seçilebilsin; iptal kalıcı olmaktan çıkıp duraklat/devam olsun.

**Architecture:** `Invite` satırındaki tekil `usedAt`/`usedByUserId`/`reservedAt` üçlüsü yeni `InviteRedemption` tablosuna taşınır. Kontenjan kapısı `SELECT … FOR UPDATE` ile serileştirilir; rezervasyon TTL'i (5 dk) sayım sorgusunun `WHERE`'inde yaşar, telafi kodu yazılmaz. Kademe (ADMIN/SUPERADMIN) daveti çok kullanımlı ya da 24 saatten uzun olamaz.

**Tech Stack:** Next.js 16 (App Router, server actions), Prisma + PostgreSQL, Auth.js (`@auth/prisma-adapter`), zod 4, Vitest (integration, gerçek DB), Playwright (e2e), shadcn/ui + Tailwind.

**Spec:** [docs/superpowers/specs/2026-08-19-ozellestirilebilir-davet-design.md](../specs/2026-08-19-ozellestirilebilir-davet-design.md)

## Global Constraints

- **Arayüz dili Türkçe.** Kullanıcıya görünen her metin Türkçe. `Activity.verb` veritabanında İngilizce saklanır, gösterim `src/lib/activity-labels.ts` sözlüğünden geçer. Yeni verb eklenirse sözlüğe karşılığı da eklenir.
- **Kod yorumları Türkçe**, mevcut dosyaların üslubuyla: kararın *neden* öyle olduğunu anlatır, kodun ne yaptığını tekrar etmez.
- **`src/server/invite-service.ts` `'use server'` TAŞIMAZ.** Bu dosyadaki fonksiyonlar oturum/token kontrolü yapmaz; `'use server'` eklenirse `applyInvite(inviteId, userId)` herkese açık bir RPC olur ve çağıran istediği `userId`'yi ADMIN yapabilir.
- **Kademe dağıtımı SUPERADMIN kapısıdır.** `createInvite` içindeki `input.globalRole !== 'MEMBER' && actor.globalRole !== 'SUPERADMIN'` kontrolü hiçbir görevde gevşetilmez.
- **Ham davet token'ı yalnızca üretim anında bir kez döner.** Veritabanında yalnızca `tokenHash` (SHA-256) durur. Hiçbir görev token'ı okunabilir saklamaz, loglamaz, sunucuya geri göndermez.
- **Rezervasyon TTL'i `INVITE_RESERVATION_TTL_MS = 5 * 60 * 1000`** — değişmez.
- **Kademe daveti sınırı:** `maxUses === 1` ve süre `≤ 24 saat` (`ELEVATED_MAX_DURATION_MS`).
- **Doğrulama komutları:** `pnpm typecheck` (sıfır hata), `pnpm test` (hepsi geçer), `pnpm lint`. Testler gerçek Postgres'e karşı koşar; `pnpm dev` AÇIKSA e2e kırılır (bilinen tuzak).

---

### Task 1: Veri modeli — kullanımlar `InviteRedemption` satırlarına taşınır

Bu görev **davranışı değiştirmez**: davet hâlâ tek kullanımlık ve 7 gün. Yalnızca kullanımın nerede saklandığı değişir. Süre/limit/etiket girdileri sonraki görevlerde eklenir.

Görev büyük ama bölünemez: şema değişikliği çağrı yerleri güncellenmeden ağaç derlenmez.

**Files:**
- Modify: `prisma/schema.prisma:220-245` (Invite modeli), `User` modeli (`usedInvites` ilişkisi)
- Create: `prisma/migrations/<timestamp>_invite_redemption/migration.sql`
- Modify: `src/server/invite-service.ts` (tamamı)
- Modify: `src/lib/auth/config.ts:47-50` (signIn), `:88-110` (createUser)
- Modify: `src/server/invites.ts:36-49` (createInvite handler), `:53-67` (revokeInvite)
- Modify: `src/app/invite/[token]/page.tsx:26`
- Modify: `src/app/(app)/admin/page.tsx:11-38`
- Modify: `prisma/seed.ts:44-58`
- Test: `tests/integration/invites.test.ts` (yeniden yazılır), `tests/integration/registration-flow.test.ts:95-195`

**Interfaces:**
- Consumes: `hashInviteToken(token): string`, `createInviteToken(): { token, tokenHash }`, `inviteExpiry(): Date` (`src/lib/auth/invite-token.ts`); `recordActivity(client, entry)`; `ok/fail/Result` (`src/lib/result.ts`)
- Produces:
  - `INVITE_RESERVATION_TTL_MS: number`
  - `claimInvite(tokenHash: string): Promise<Result<{ redemptionId: string; inviteId: string }>>` — **imza değişti**, artık `boolean` değil
  - `applyInvite(inviteId: string, userId: string, redemptionId?: string): Promise<Result<{ channelId: string | null }>>`
  - `consumeInvite(token: string, userId: string): Promise<Result<{ channelId: string | null }>>`
  - Prisma modeli `InviteRedemption { id, inviteId, userId, reservedAt, redeemedAt }`
  - `Invite` alanları: `label: string | null`, `maxUses: number | null`, `expiresAt: Date | null`, `disabledAt: Date | null`

- [ ] **Step 1: Testleri yeni modele göre yeniden yaz**

`tests/integration/invites.test.ts` içindeki `seedInvite` yardımcısını ve `usedAt`/`usedByUserId`/`revokedAt` bekleyen assert'leri değiştir. Yardımcı:

```ts
async function seedInvite(
  overrides: Partial<{
    expiresAt: Date | null
    disabledAt: Date | null
    maxUses: number | null
    channelId: string | null
    globalRole: 'SUPERADMIN' | 'ADMIN' | 'MEMBER'
  }> = {},
) {
  const { token, tokenHash } = createInviteToken()
  const invite = await db.invite.create({
    data: {
      tokenHash,
      globalRole: overrides.globalRole ?? 'MEMBER',
      channelId: 'channelId' in overrides ? overrides.channelId : channelId,
      channelRole: 'MEMBER',
      expiresAt: 'expiresAt' in overrides ? overrides.expiresAt : new Date(Date.now() + 7 * 864e5),
      disabledAt: overrides.disabledAt ?? null,
      maxUses: 'maxUses' in overrides ? overrides.maxUses : 1,
      createdById: adminId,
    },
  })
  return { token, tokenHash, inviteId: invite.id }
}

async function redemptions(inviteId: string) {
  return db.inviteRedemption.findMany({ where: { inviteId }, orderBy: { reservedAt: 'asc' } })
}
```

Assert'lerin yeni karşılıkları:

```ts
// eski: expect(invite.usedByUserId).toBe(user.id) / expect(invite.usedAt).not.toBeNull()
const rows = await redemptions(inviteId)
expect(rows).toHaveLength(1)
expect(rows[0].userId).toBe(user.id)
expect(rows[0].redeemedAt).not.toBeNull()

// eski: expect(invite.usedAt).toBeNull() (rezervasyon var, tüketim yok)
const rows = await redemptions(inviteId)
expect(rows).toHaveLength(1)
expect(rows[0].userId).toBeNull()
expect(rows[0].redeemedAt).toBeNull()
```

`revokedAt: new Date()` geçen çağrılar `disabledAt: new Date()` olur. `claimInvite` dönüşünü bekleyen testler `expect((await claimInvite(tokenHash)).ok).toBe(true)` biçimine döner. TTL testindeki

```ts
data: { reservedAt: new Date(Date.now() - INVITE_RESERVATION_TTL_MS - 1000) },
```

güncellemesi artık `db.inviteRedemption.updateMany({ where: { inviteId }, data: { reservedAt: ... } })` olur.

Ayrıca **iki yeni test** ekle:

```ts
it('kontenjan dolunca claimInvite reddeder', async () => {
  const { tokenHash } = await seedInvite({ maxUses: 2 })
  expect((await claimInvite(tokenHash)).ok).toBe(true)
  expect((await claimInvite(tokenHash)).ok).toBe(true)

  const third = await claimInvite(tokenHash)
  expect(third.ok).toBe(false)
  if (!third.ok) expect(third.error.code).toBe('CONFLICT')
})

it('eşzamanlı iki claimInvite tek slotu paylaşmaz', async () => {
  const { tokenHash } = await seedInvite({ maxUses: 1 })

  const [a, b] = await Promise.all([claimInvite(tokenHash), claimInvite(tokenHash)])

  expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
  expect(await db.inviteRedemption.count()).toBe(1)
})

it('aynı kullanıcının ikinci consumeInvite çağrısı slot yakmaz', async () => {
  const { token, inviteId } = await seedInvite({ maxUses: 5 })
  const user = await db.user.create({ data: { name: 'Tekrar', email: 't@x.com' } })

  await consumeInvite(token, user.id)
  const second = await consumeInvite(token, user.id)

  expect(second).toEqual({ ok: true, data: { channelId } })
  expect(await db.inviteRedemption.count({ where: { inviteId } })).toBe(1)
})

it('süresiz davet (expiresAt null) geçerlidir', async () => {
  const { token } = await seedInvite({ expiresAt: null, maxUses: null })
  const user = await db.user.create({ data: { name: 'Süresiz', email: 's@x.com' } })

  expect((await consumeInvite(token, user.id)).ok).toBe(true)
})
```

- [ ] **Step 2: Testleri çalıştır, kırmızı olduklarını gör**

Run: `pnpm test tests/integration/invites.test.ts`
Expected: FAIL — `db.inviteRedemption` tanımsız, `Unknown argument 'disabledAt'`.

- [ ] **Step 3: Şemayı güncelle**

`prisma/schema.prisma` — `Invite` modelini şununla değiştir:

```prisma
model Invite {
  id          String      @id @default(cuid())
  tokenHash   String      @unique
  globalRole  GlobalRole  @default(MEMBER)
  channelId   String?
  channelRole ChannelRole @default(MEMBER)

  // Davetin ne kadar yaşayacağı ve kaç kişiye açık olduğu üretim anında
  // seçilir. null = sınır yok: `expiresAt` null ise süresiz, `maxUses` null
  // ise kontenjansız. Kademe daveti bu ikisini kullanamaz — kural
  // `src/server/invites.ts` içindeki superRefine'da.
  label       String?
  maxUses     Int?
  expiresAt   DateTime?
  // Kalıcı iptal DEĞİL, geri alınabilir kapatma: çok kullanımlı bir
  // bağlantıyı "şimdilik durdur" diye yönetmenin yolu. Kullanılmış slotlar
  // geri gelmez; devam ettirilen davet kalan kontenjanından sürer.
  disabledAt  DateTime?

  createdById String?
  createdAt   DateTime    @default(now())

  channel     Channel?           @relation(fields: [channelId], references: [id], onDelete: SetNull)
  createdBy   User?              @relation("InviteCreatedBy", fields: [createdById], references: [id])
  redemptions InviteRedemption[]

  @@index([expiresAt])
}

// Bir davetin TEK bir kullanımı. Eskiden bu bilgi Invite satırındaki
// usedAt/usedByUserId/reservedAt üçlüsündeydi ve davet başına tek kullanımı
// yapısal olarak dayatıyordu.
//
// `userId` rezervasyon anında NULL'dur: signIn callback'i daveti createUser'dan
// ÖNCE rezerve eder, kullanıcı satırı o an henüz yoktur. Postgres'te NULL'lar
// unique kısıtta çakışmadığı için aynı davete ait birden çok açık rezervasyon
// yan yana durabilir — eşzamanlı kayıt akışları için gereken tam olarak budur.
// Kısıt userId bağlandıktan sonra devreye girer ve aynı kişinin aynı bağlantıyla
// ikinci bir slot yakmasını imkânsız kılar.
model InviteRedemption {
  id         String    @id @default(cuid())
  inviteId   String
  userId     String?
  reservedAt DateTime  @default(now())
  redeemedAt DateTime?

  invite Invite @relation(fields: [inviteId], references: [id], onDelete: Cascade)
  user   User?  @relation("InviteRedeemedBy", fields: [userId], references: [id], onDelete: SetNull)

  @@unique([inviteId, userId])
  @@index([inviteId, reservedAt])
}
```

`User` modelinde `usedInvites    Invite[]        @relation("InviteUsedBy")` satırını şununla değiştir:

```prisma
  inviteRedemptions InviteRedemption[] @relation("InviteRedeemedBy")
```

- [ ] **Step 4: Migration'ı elle yaz**

Run: `pnpm exec prisma migrate dev --create-only --name invite_redemption`

Üretilen `migration.sql`'in **tamamını** şununla değiştir (Prisma'nın ürettiği hâli veriyi korumaz — kullanılmış davetleri taşımadan kolonları düşürür):

```sql
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
```

- [ ] **Step 5: Migration'ı uygula**

Run: `pnpm db:migrate`
Expected: migration uygulanır, Prisma Client yeniden üretilir, `InviteRedemption` tipi çıkar.

> **Tuzak:** Migration'ı bir worktree'den uygularsan ana checkout'un uygulaması aynı dev DB'sine bakar ve şema uyuşmazlığı yüzünden patlar. Uygulamayı migrate ettiğin checkout'tan çalıştır.

- [ ] **Step 6: `invite-service.ts`'i yeniden yaz**

Dosyanın tamamı (dosya başındaki `'use server' taşımaz` yorum bloğu **aynen korunur**):

```ts
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { hashInviteToken } from '@/lib/auth/invite-token'
import { recordActivity } from '@/lib/activity'
import { fail, ok, type Result } from '@/lib/result'

export const INVITE_RESERVATION_TTL_MS = 5 * 60 * 1000

/**
 * Davete bir kullanım slotu REZERVE eder — kalıcı sahiplenme değildir.
 *
 * Kontenjan kontrolü "say, sonra ekle" olduğu için tek bir koşullu updateMany
 * ile ifade edilemez; iki eşzamanlı istek aynı boş slotu okuyabilirdi. Bu
 * yüzden transaction Invite satırını FOR UPDATE ile kilitler: aynı davete
 * gelen istekler serileşir, farklı davetler birbirini beklemez.
 *
 * Rezervasyonun TTL'i ayrı bir alan ya da temizlik işi değil, aşağıdaki sayım
 * sorgusunun WHERE'idir: uçuşta olmayan (TTL'i geçmiş) ve kalıcılaşmamış bir
 * satır kontenjandan otomatik düşer. Denormalize bir sayaç bunu yapamazdı —
 * hangi artışın hangi rezervasyona ait olduğunu bilmediği için TTL dolduğunda
 * neyi geri düşüreceğini de bilemezdi.
 */
export async function claimInvite(
  tokenHash: string,
): Promise<Result<{ redemptionId: string; inviteId: string }>> {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Invite" WHERE "tokenHash" = ${tokenHash} FOR UPDATE
    `
    const lockedId = locked[0]?.id
    if (!lockedId) return fail('NOT_FOUND')

    const invite = await tx.invite.findUniqueOrThrow({ where: { id: lockedId } })
    const now = new Date()
    if (invite.disabledAt) return fail('CONFLICT')
    if (invite.expiresAt && invite.expiresAt <= now) return fail('CONFLICT')

    if (invite.maxUses !== null) {
      const cutoff = new Date(now.getTime() - INVITE_RESERVATION_TTL_MS)
      const live = await tx.inviteRedemption.count({
        where: {
          inviteId: invite.id,
          OR: [{ redeemedAt: { not: null } }, { reservedAt: { gt: cutoff } }],
        },
      })
      if (live >= invite.maxUses) return fail('CONFLICT')
    }

    const redemption = await tx.inviteRedemption.create({
      data: { inviteId: invite.id, reservedAt: now },
    })
    return ok({ redemptionId: redemption.id, inviteId: invite.id })
  })
}

/**
 * Rezerve edilmiş bir slotu kalıcı tüketime çevirir VE davetin etkilerini
 * (kademe, kanal üyeliği, activity) aynı transaction içinde uygular. Biri
 * başarısız olursa slot da kalıcılaşmaz; rezervasyon TTL sonunda serbest
 * kalır, davet yanmaz.
 *
 * `redemptionId` verilmezse satır aranır: `signIn` ile `createUser` arasında
 * çerezdeki token dışında taşınabilen bir durum yok, çok kullanımlı davette
 * ise aynı anda birden çok açık rezervasyon olabilir. Koşullu updateMany
 * (`userId: null`) hangi çağrının hangi satırı kazandığını belirler.
 *
 * Bu fonksiyon kendi başına bir yetki sınırı DEĞİLDİR — yalnızca `claimInvite`
 * slotu gerçekten rezerve ettikten sonra çağrılmalıdır.
 */
export async function applyInvite(
  inviteId: string,
  userId: string,
  redemptionId?: string,
): Promise<Result<{ channelId: string | null }>> {
  const invite = await db.invite.findUnique({ where: { id: inviteId } })
  if (!invite) return fail('NOT_FOUND')

  try {
    const confirmed = await db.$transaction(async (tx) => {
      const candidates = redemptionId
        ? [{ id: redemptionId }]
        : await tx.inviteRedemption.findMany({
            where: {
              inviteId,
              userId: null,
              redeemedAt: null,
              reservedAt: { gt: new Date(Date.now() - INVITE_RESERVATION_TTL_MS) },
            },
            orderBy: { reservedAt: 'asc' },
            select: { id: true },
          })

      let claimed = false
      for (const candidate of candidates) {
        const result = await tx.inviteRedemption.updateMany({
          where: { id: candidate.id, userId: null, redeemedAt: null },
          data: { userId, redeemedAt: new Date() },
        })
        if (result.count === 1) {
          claimed = true
          break
        }
      }
      if (!claimed) return false

      // Davetin taşıdığı kademe ne ise o uygulanır. Tek bir enum değerini
      // isimle kontrol etmek (`=== 'ADMIN'`), enum üçüncü kademeyi kazandığında
      // sessizce yetki düşüren bir desendi.
      if (invite.globalRole !== 'MEMBER') {
        await tx.user.update({
          where: { id: userId },
          data: { globalRole: invite.globalRole },
        })
      }
      if (invite.channelId) {
        await tx.channelMember.upsert({
          where: { channelId_userId: { channelId: invite.channelId, userId } },
          create: { channelId: invite.channelId, userId, channelRole: invite.channelRole },
          update: {},
        })
      }
      await recordActivity(tx, {
        actorId: userId, verb: 'invite.accepted',
        entityType: 'Invite', entityId: invite.id,
      })
      return true
    })

    if (!confirmed) return fail('CONFLICT')
    return ok({ channelId: invite.channelId })
  } catch (error) {
    // Aynı kullanıcı için ikinci bir slot: @@unique([inviteId, userId]).
    // Eşzamanlı çift tıkta düşer; çağıran zaten daveti kullanmış demektir.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return ok({ channelId: invite.channelId })
    }
    throw error
  }
}

/**
 * Zaten giriş yapmış kullanıcı için davet kullanımı (ikinci bir kanala davet).
 * Action değildir: yetki kontrolü token'ın kendisidir.
 *
 * Kullanıcı bu daveti daha önce kullandıysa slot yakılmadan başarı döner —
 * çift tık kontenjan tüketmemeli. Uygulama başarısız olursa rezervasyon
 * TTL'i beklemeden serbest bırakılır.
 */
export async function consumeInvite(
  token: string,
  userId: string,
): Promise<Result<{ channelId: string | null }>> {
  const tokenHash = hashInviteToken(token)
  const invite = await db.invite.findUnique({ where: { tokenHash } })
  if (!invite) return fail('NOT_FOUND')

  const existing = await db.inviteRedemption.findUnique({
    where: { inviteId_userId: { inviteId: invite.id, userId } },
  })
  if (existing) return ok({ channelId: invite.channelId })

  const claimed = await claimInvite(tokenHash)
  if (!claimed.ok) return claimed

  const applied = await applyInvite(invite.id, userId, claimed.data.redemptionId)
  if (!applied.ok) {
    await db.inviteRedemption.deleteMany({
      where: { id: claimed.data.redemptionId, userId: null },
    })
  }
  return applied
}
```

- [ ] **Step 7: `config.ts`'i yeni imzaya uyarla**

`signIn` callback'inin son satırı:

```ts
      const store = await cookies()
      const token = store.get(INVITE_COOKIE)?.value
      if (!token) return false
      return (await claimInvite(hashInviteToken(token))).ok
```

`createUser` event'inde `invite.usedByUserId` kontrolü artık yok:

```ts
      const invite = await db.invite.findUnique({
        where: { tokenHash: hashInviteToken(token) },
      })
      if (!invite) return
      try {
        const result = await applyInvite(invite.id, user.id)
```

Yorumlardaki `usedAt` göndermeleri `redemption satırı` diline çevrilir; anlam aynı kalır.

- [ ] **Step 8: `invites.ts` — `revokeInvite` `disabledAt` yazar**

`createInvite` handler'ında `db.invite.create` çağrısına `maxUses: 1` eklenir (bugünkü davranış açıkça yazılır; girdi Task 3'te gelir).

`revokeInvite` handler'ında `data: { revokedAt: new Date() }` → `data: { disabledAt: new Date() }`. Action adı bu görevde **değişmez** (toggle Task 6'da).

- [ ] **Step 9: `/invite/[token]` sayfasını uyarla**

```ts
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: {
      channel: true,
      redemptions: { where: { redeemedAt: { not: null } }, select: { id: true } },
    },
  })

  const invalid =
    !invite ||
    invite.disabledAt !== null ||
    (invite.expiresAt !== null && invite.expiresAt < new Date()) ||
    (invite.maxUses !== null && invite.redemptions.length >= invite.maxUses)
```

Gerekçeli mesaj ayrımı Task 8'de; bu adımda mevcut tek mesaj korunur.

- [ ] **Step 10: Admin listesini uyarla**

`src/app/(app)/admin/page.tsx` başındaki iki yardımcıyı şununla değiştir:

```tsx
type InviteRow = {
  maxUses: number | null
  expiresAt: Date | null
  disabledAt: Date | null
  redemptions: { redeemedAt: Date | null }[]
}

function usedCount(invite: InviteRow): number {
  return invite.redemptions.filter((r) => r.redeemedAt !== null).length
}

function inviteStatus(invite: InviteRow): string {
  if (invite.disabledAt) return 'duraklatıldı'
  if (invite.expiresAt && invite.expiresAt < new Date()) return 'süresi doldu'
  if (invite.maxUses !== null && usedCount(invite) >= invite.maxUses) return 'kontenjan doldu'
  return 'bekliyor'
}

function isPending(invite: InviteRow): boolean {
  return inviteStatus(invite) === 'bekliyor'
}
```

Sorgunun `include`'u:

```ts
      include: {
        channel: { select: { name: true } },
        redemptions: { select: { redeemedAt: true } },
      },
```

- [ ] **Step 11: `seed.ts`'teki bekleyen-davet kontrolünü uyarla**

`seedBootstrapInvite` içindeki `outstanding` sorgusu:

```ts
        const outstanding = await tx.invite.findFirst({
          where: {
            createdById: null,
            disabledAt: null,
            expiresAt: { gt: new Date() },
            redemptions: { none: { redeemedAt: { not: null } } },
          },
        })
```

Uyarı metnindeki `(revokedAt)` → `(disabledAt)`.

**Ayrıca `tx.invite.create` verisine `maxUses: 1` eklenir.** Alan artık nullable
ve `null` = SINIRSIZ demek: eklenmezse kurulum daveti (SUPERADMIN!) sınırsız
kullanımlı olurdu.

```ts
        await tx.invite.create({
          data: {
            tokenHash,
            globalRole: 'SUPERADMIN',
            channelId: null,
            createdById: null,
            expiresAt: inviteExpiry(),
            // null = sınırsız. Kurulum daveti tek sahibi açar.
            maxUses: 1,
          },
        })
```

- [ ] **Step 12: CLI script'ine de `maxUses: 1` ekle**

`scripts/create-invite.ts` aynı tuzağa düşer — ADMIN daveti basıyor ve
`maxUses` verilmezse sınırsız olur:

```ts
  await db.invite.create({
    data: {
      tokenHash,
      globalRole: 'ADMIN',
      channelId: null,
      channelRole: 'MEMBER',
      expiresAt: inviteExpiry(),
      // null = sınırsız; bu script tek bir admin daveti basmak içindir.
      maxUses: 1,
    },
  })
```

- [ ] **Step 13: `registration-flow.test.ts`'i uyarla**

`invite.usedByUserId` / `invite.usedAt` bekleyen assert'ler redemption satırına döner:

```ts
    const rows = await db.inviteRedemption.findMany({ where: { inviteId: invite.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBe(createdUser.id)
    expect(rows[0].redeemedAt).not.toBeNull()
```

TTL'i geriye alan güncelleme:

```ts
    await db.inviteRedemption.updateMany({
      where: { inviteId: invite.id },
      data: { reservedAt: new Date(Date.now() - 6 * 60 * 1000) },
    })
```

- [ ] **Step 14: Testleri ve typecheck'i çalıştır**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: hepsi geçer, sıfır TS hatası.

- [ ] **Step 15: Commit**

```bash
git add prisma src tests
git commit -m "refactor: davet kullanımlarını InviteRedemption satırlarına taşı

Invite satırındaki tekil usedAt/usedByUserId/reservedAt üçlüsü davet
başına tek kullanımı yapısal olarak dayatıyordu. Kontenjan kapısı artık
Invite satırını FOR UPDATE ile kilitleyip canlı kullanım sayıyor;
rezervasyon TTL'i sayım sorgusunun WHERE'inde yaşıyor.

revokedAt -> disabledAt yeniden adlandırıldı; davranış bu commit'te
değişmedi (davet hâlâ tek kullanımlık, 7 gün)."
```

---

### Task 2: Geçerlilik süresi seçilebilir olur

**Files:**
- Modify: `src/lib/auth/invite-token.ts`
- Modify: `src/server/invites.ts` (createInvite input + handler)
- Modify: `src/app/(app)/admin/create-invite-form.tsx`
- Test: `tests/unit/invite-token.test.ts`, `tests/integration/invite-actions.test.ts`

**Interfaces:**
- Consumes: Task 1'in `Invite.expiresAt: Date | null` alanı
- Produces:
  - `INVITE_DURATIONS: { HOUR: number; DAY: number; WEEK: number; MONTH: number; FOREVER: null }`
  - `type InviteDuration = keyof typeof INVITE_DURATIONS`
  - `DEFAULT_INVITE_DURATION: InviteDuration` (= `'WEEK'`)
  - `ELEVATED_MAX_DURATION_MS: number` (= 24 saat, Task 4 kullanır)
  - `INVITE_DURATION_LABELS: Record<InviteDuration, string>`
  - `inviteExpiry(duration?: InviteDuration): Date | null`
  - `createInvite` girdisine `duration: InviteDuration` (varsayılan `'WEEK'`)

- [ ] **Step 1: Başarısız birim testini yaz**

`tests/unit/invite-token.test.ts` sonuna:

```ts
import {
  DEFAULT_INVITE_DURATION,
  INVITE_DURATIONS,
  INVITE_DURATION_LABELS,
  inviteExpiry,
} from '@/lib/auth/invite-token'

describe('inviteExpiry', () => {
  it('varsayılan süre bir haftadır', () => {
    const expiry = inviteExpiry()
    expect(expiry).not.toBeNull()
    expect(expiry!.getTime() - Date.now()).toBeGreaterThan(6.9 * 864e5)
    expect(expiry!.getTime() - Date.now()).toBeLessThan(7.1 * 864e5)
  })

  it('FOREVER süresiz davet üretir', () => {
    expect(inviteExpiry('FOREVER')).toBeNull()
  })

  it('her süre seçeneğinin Türkçe etiketi vardır', () => {
    for (const key of Object.keys(INVITE_DURATIONS)) {
      expect(INVITE_DURATION_LABELS[key as keyof typeof INVITE_DURATIONS]).toBeTruthy()
    }
  })

  it('varsayılan süre tanımlı seçeneklerden biridir', () => {
    expect(Object.keys(INVITE_DURATIONS)).toContain(DEFAULT_INVITE_DURATION)
  })
})
```

- [ ] **Step 2: Testi çalıştır, kırmızı olduğunu gör**

Run: `pnpm test tests/unit/invite-token.test.ts`
Expected: FAIL — `INVITE_DURATIONS` export edilmiyor.

- [ ] **Step 3: `invite-token.ts`'e süre seçeneklerini ekle**

`INVITE_TTL_DAYS` ve eski `inviteExpiry` şununla değiştirilir:

```ts
/**
 * Davetin yaşayabileceği süreler. Tek kaynak: davet üreten her yol (form,
 * seed, CLI script) buradan geçer. `null` = süresiz.
 */
export const INVITE_DURATIONS = {
  HOUR: 36e5,
  DAY: 864e5,
  WEEK: 7 * 864e5,
  MONTH: 30 * 864e5,
  FOREVER: null,
} as const

export type InviteDuration = keyof typeof INVITE_DURATIONS

export const INVITE_DURATION_LABELS: Record<InviteDuration, string> = {
  HOUR: '1 saat',
  DAY: '1 gün',
  WEEK: '7 gün',
  MONTH: '30 gün',
  FOREVER: 'Süresiz',
}

export const DEFAULT_INVITE_DURATION: InviteDuration = 'WEEK'

/**
 * Kademe (ADMIN/SUPERADMIN) daveti bundan uzun yaşayamaz. Sızan bir kademe
 * bağlantısı tek gün ve tek hesapla sınırlı kalsın diye.
 */
export const ELEVATED_MAX_DURATION_MS = 24 * 36e5

export function inviteExpiry(duration: InviteDuration = DEFAULT_INVITE_DURATION): Date | null {
  const ms = INVITE_DURATIONS[duration]
  return ms === null ? null : new Date(Date.now() + ms)
}
```

`INVITE_TTL_DAYS` kaldırıldığı için `prisma/seed.ts` ve `scripts/create-invite.ts` derlenmeye devam eder (ikisi de `inviteExpiry()` çağırıyor, varsayılan hâlâ 7 gün).

- [ ] **Step 4: Birim testini çalıştır**

Run: `pnpm test tests/unit/invite-token.test.ts`
Expected: PASS

- [ ] **Step 5: Action için başarısız entegrasyon testini yaz**

`tests/integration/invite-actions.test.ts` içindeki `createInvite` describe'ına:

```ts
  it('seçilen süre daveti o kadar yaşatır', async () => {
    actorRef.current = admin.id

    const r = await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', duration: 'HOUR',
    })

    expect(r.ok).toBe(true)
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.expiresAt!.getTime() - Date.now()).toBeLessThan(61 * 60 * 1000)
    expect(invite.expiresAt!.getTime() - Date.now()).toBeGreaterThan(59 * 60 * 1000)
  })

  it('FOREVER süresiz davet üretir', async () => {
    actorRef.current = admin.id

    await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', duration: 'FOREVER',
    })

    const invite = await db.invite.findFirstOrThrow()
    expect(invite.expiresAt).toBeNull()
  })

  it('süre verilmezse 7 gündür', async () => {
    actorRef.current = admin.id

    await createInvite({ globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER' })

    const invite = await db.invite.findFirstOrThrow()
    expect(invite.expiresAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * 864e5)
  })
```

- [ ] **Step 6: Testi çalıştır, kırmızı olduğunu gör**

Run: `pnpm test tests/integration/invite-actions.test.ts`
Expected: FAIL — `duration` girdisi tanınmıyor, `expiresAt` her zaman 7 gün.

- [ ] **Step 7: `createInvite`'a `duration` girdisini ekle**

`src/server/invites.ts` — import satırına `INVITE_DURATIONS`, `DEFAULT_INVITE_DURATION` ve `type InviteDuration` eklenir; input şeması:

```ts
  input: z.object({
    globalRole: z.enum(['SUPERADMIN', 'ADMIN', 'MEMBER']).default('MEMBER'),
    channelId: z.string().cuid().nullable().default(null),
    channelRole: z.enum(['LEAD', 'MEMBER']).default('MEMBER'),
    duration: z
      .enum(Object.keys(INVITE_DURATIONS) as [InviteDuration, ...InviteDuration[]])
      .default(DEFAULT_INVITE_DURATION),
  }),
```

Handler'da `expiresAt: inviteExpiry()` → `expiresAt: inviteExpiry(input.duration)`.

- [ ] **Step 8: Testleri çalıştır**

Run: `pnpm test tests/integration/invite-actions.test.ts`
Expected: PASS

- [ ] **Step 9: Forma süre seçicisini ekle**

`create-invite-form.tsx` — importlara:

```tsx
import {
  DEFAULT_INVITE_DURATION,
  INVITE_DURATION_LABELS,
  type InviteDuration,
} from '@/lib/auth/invite-token'
```

State:

```tsx
  const [duration, setDuration] = useState<InviteDuration>(DEFAULT_INVITE_DURATION)
```

Kanal rolü alanından sonra, gönder butonundan önce:

```tsx
        <div className="space-y-1">
          <Label>Geçerlilik</Label>
          <Select value={duration} onValueChange={(v) => setDuration(v as InviteDuration)}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(INVITE_DURATION_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
```

`createInvite` çağrısına `duration` eklenir.

- [ ] **Step 10: Doğrula ve commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src tests
git commit -m "feat: davet süresi seçilebilir olsun

1 saat / 1 gün / 7 gün / 30 gün / süresiz. Sabit INVITE_TTL_DAYS yerine
INVITE_DURATIONS sözlüğü: davet üreten her yol (form, seed, CLI) aynı
kaynaktan geçiyor."
```

---

### Task 3: Kullanım limiti seçilebilir olur

**Files:**
- Modify: `src/lib/auth/invite-token.ts` (limit seçenekleri)
- Modify: `src/server/invites.ts`
- Modify: `src/app/(app)/admin/create-invite-form.tsx`
- Test: `tests/integration/invite-actions.test.ts`

**Interfaces:**
- Consumes: Task 1'in `Invite.maxUses`, Task 2'nin form yapısı
- Produces: `INVITE_USE_LIMITS: readonly (number | null)[]`, `INVITE_USE_LIMIT_LABELS`, `createInvite` girdisine `maxUses: number | null` (varsayılan `1`)

- [ ] **Step 1: Başarısız testi yaz**

```ts
  it('kullanım limiti davete yazılır', async () => {
    actorRef.current = admin.id

    await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', maxUses: 25,
    })

    expect((await db.invite.findFirstOrThrow()).maxUses).toBe(25)
  })

  it('null limit sınırsız davet üretir', async () => {
    actorRef.current = admin.id

    await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', maxUses: null,
    })

    expect((await db.invite.findFirstOrThrow()).maxUses).toBeNull()
  })

  it('limit verilmezse tek kullanımlıktır', async () => {
    actorRef.current = admin.id

    await createInvite({ globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER' })

    expect((await db.invite.findFirstOrThrow()).maxUses).toBe(1)
  })

  it('sıfır veya negatif limit reddedilir', async () => {
    actorRef.current = admin.id

    const r = await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', maxUses: 0,
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('VALIDATION')
  })
```

- [ ] **Step 2: Testi çalıştır, kırmızı olduğunu gör**

Run: `pnpm test tests/integration/invite-actions.test.ts`
Expected: FAIL — `maxUses` her davette 1.

- [ ] **Step 3: Limit seçeneklerini `invite-token.ts`'e ekle**

```ts
/**
 * Formda sunulan kullanım limitleri. `null` = sınırsız. Sunucu bu listeyle
 * sınırlı değildir (pozitif tam sayı yeter) — liste yalnızca arayüzün seçim
 * kümesi ve etiketleri.
 */
export const INVITE_USE_LIMITS = [1, 5, 25, null] as const

export const INVITE_USE_LIMIT_LABELS = new Map<number | null, string>([
  [1, '1 kişi'],
  [5, '5 kişi'],
  [25, '25 kişi'],
  [null, 'Sınırsız'],
])
```

- [ ] **Step 4: `createInvite`'a `maxUses` girdisini ekle**

Input şemasına:

```ts
    maxUses: z.number().int().positive().nullable().default(1),
```

Handler'daki `db.invite.create` çağrısında Task 1'de sabitlenen `maxUses: 1` → `maxUses: input.maxUses`.

- [ ] **Step 5: Testleri çalıştır**

Run: `pnpm test tests/integration/invite-actions.test.ts`
Expected: PASS

- [ ] **Step 6: Forma limit seçicisini ekle**

Form importlarına `INVITE_USE_LIMITS` ve `INVITE_USE_LIMIT_LABELS` eklenir.

State:

```tsx
  const [maxUses, setMaxUses] = useState<number | null>(1)
```

Süre alanının yanına:

```tsx
        <div className="space-y-1">
          <Label>Kullanım limiti</Label>
          <Select
            value={maxUses === null ? 'unlimited' : String(maxUses)}
            onValueChange={(v) => setMaxUses(v === 'unlimited' ? null : Number(v))}
          >
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {INVITE_USE_LIMITS.map((limit) => (
                <SelectItem key={limit ?? 'unlimited'} value={limit === null ? 'unlimited' : String(limit)}>
                  {INVITE_USE_LIMIT_LABELS.get(limit)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
```

`createInvite` çağrısına `maxUses` eklenir.

- [ ] **Step 7: Çok kullanımlı bağlantı uyarısını vurgula**

Üretilen bağlantı kutusundaki uyarı metnini limite göre değiştir:

```tsx
          <p className="text-xs text-muted-foreground">
            {maxUses === 1
              ? 'Bu bağlantı yalnızca bir kez gösterilir — şimdi kopyala, sayfadan ayrılınca tekrar erişemezsin.'
              : 'Bu bağlantı yalnızca bir kez gösterilir ve tekrar üretilemez. Birden çok kişiye dağıtacaksan ŞİMDİ güvenli bir yere kaydet — kaybedersen yeni bir davet oluşturman gerekir.'}
          </p>
```

- [ ] **Step 8: Doğrula ve commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src tests
git commit -m "feat: davete kullanım limiti eklenebilsin

1 / 5 / 25 / sınırsız. Kontenjan kapısı Task 1'de hazırdı; bu commit
girdiyi ve form seçicisini bağlıyor. Çok kullanımlı bağlantı bir daha
gösterilemediği için uyarı metni limite göre sertleşiyor."
```

---

### Task 4: Kademe daveti sertleştirilir

Kademe dağıtan davet (`globalRole !== 'MEMBER'`) çok kullanımlı ya da 24 saatten uzun **olamaz**.

**Files:**
- Modify: `src/server/invites.ts` (input şemasına `superRefine`)
- Modify: `src/app/(app)/admin/create-invite-form.tsx` (alan kilidi)
- Test: `tests/integration/invite-actions.test.ts`

**Interfaces:**
- Consumes: `ELEVATED_MAX_DURATION_MS`, `INVITE_DURATIONS` (Task 2)
- Produces: yok (davranış kısıtı)

- [ ] **Step 1: Başarısız testleri yaz**

```ts
describe('createInvite — kademe daveti sınırları', () => {
  it('ADMIN daveti çok kullanımlı olamaz', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'ADMIN', channelId: null, channelRole: 'MEMBER', maxUses: 5, duration: 'DAY',
    })

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('VALIDATION')
      expect(r.error.fields?.maxUses).toBeTruthy()
    }
    expect(await db.invite.count()).toBe(0)
  })

  it('ADMIN daveti sınırsız olamaz', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'ADMIN', channelId: null, channelRole: 'MEMBER', maxUses: null, duration: 'DAY',
    })

    expect(r.ok).toBe(false)
  })

  it('SUPERADMIN daveti 24 saatten uzun yaşayamaz', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'SUPERADMIN', channelId: null, channelRole: 'MEMBER', maxUses: 1, duration: 'WEEK',
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.fields?.duration).toBeTruthy()
  })

  it('ADMIN daveti süresiz olamaz', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'ADMIN', channelId: null, channelRole: 'MEMBER', maxUses: 1, duration: 'FOREVER',
    })

    expect(r.ok).toBe(false)
  })

  it('sınırlar içindeki ADMIN daveti kabul edilir', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'ADMIN', channelId: null, channelRole: 'MEMBER', maxUses: 1, duration: 'DAY',
    })

    expect(r.ok).toBe(true)
  })

  it('MEMBER daveti sınırsız ve süresiz olabilir', async () => {
    actorRef.current = admin.id

    const r = await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', maxUses: null, duration: 'FOREVER',
    })

    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Testleri çalıştır, kırmızı olduklarını gör**

Run: `pnpm test tests/integration/invite-actions.test.ts`
Expected: FAIL — kademe davetleri sınırsız/uzun süreli üretilebiliyor.

- [ ] **Step 3: `superRefine` ekle**

`src/server/invites.ts` — input şemasının sonuna:

```ts
  })
    /**
     * Davet, kademe dağıtmanın ikinci kapısıdır: `/invite/<token>` sayfası
     * oturum açmış kullanıcıya daveti KENDİSİ için uygulatır. Bu yüzden
     * kademe taşıyan bir bağlantı ne çok kullanımlı ne de uzun ömürlü
     * olabilir — sızarsa tek hesapla ve tek günle sınırlı kalmalı.
     */
    .superRefine((value, ctx) => {
      if (value.globalRole === 'MEMBER') return

      if (value.maxUses !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['maxUses'],
          message: 'Kademe daveti yalnızca tek kişilik olabilir.',
        })
      }

      const ms = INVITE_DURATIONS[value.duration]
      if (ms === null || ms > ELEVATED_MAX_DURATION_MS) {
        ctx.addIssue({
          code: 'custom',
          path: ['duration'],
          message: 'Kademe daveti en fazla 24 saat geçerli olabilir.',
        })
      }
    }),
```

Import satırına `ELEVATED_MAX_DURATION_MS` eklenir.

> `defineAction` `safeParse` hatalarını `fail('VALIDATION', fields)`'e çevirir; `path` alan adına döner, dolayısıyla `r.error.fields.maxUses` / `.duration` dolu gelir.

- [ ] **Step 4: Testleri çalıştır**

Run: `pnpm test tests/integration/invite-actions.test.ts`
Expected: PASS

- [ ] **Step 5: Formda alanları kilitle**

`create-invite-form.tsx` — rol seçimine tepki veren türetilmiş değer ve etki:

```tsx
  const elevated = globalRole !== 'MEMBER'

  // Kademe seçildiğinde tek geçerli kombinasyona düşülür. Bu bir yetki
  // kapısı DEĞİL, kolaylıktır — asıl kural invites.ts'in superRefine'ında.
  function handleGlobalRoleChange(value: InviteGlobalRole) {
    setGlobalRole(value)
    if (value !== 'MEMBER') {
      setMaxUses(1)
      setDuration('DAY')
    }
  }
```

`Select value={globalRole} onValueChange={...}` çağrısı `handleGlobalRoleChange`'e bağlanır. Süre ve limit `Select`'lerine `disabled={elevated}` eklenir, formun altına:

```tsx
      {elevated && (
        <p className="text-xs text-muted-foreground">
          Kademe daveti tek kişilik ve en fazla 24 saat geçerli olabilir.
        </p>
      )}
```

Süre seçeneklerinden 24 saati aşanlar kademe modunda listelenmez (form
importlarına `INVITE_DURATIONS` ve `ELEVATED_MAX_DURATION_MS` eklenir):

```tsx
              {Object.entries(INVITE_DURATION_LABELS)
                .filter(([value]) => {
                  if (!elevated) return true
                  const ms = INVITE_DURATIONS[value as InviteDuration]
                  return ms !== null && ms <= ELEVATED_MAX_DURATION_MS
                })
                .map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
```

- [ ] **Step 6: Kurulum davetinin muafiyetini yorumla yaz**

`prisma/seed.ts` içindeki `seedBootstrapInvite` SUPERADMIN daveti üretir ve
7 gün yaşar — yani bu görevin kuralına uymaz. Bu **bilinçli bir muafiyettir**:
kurulum daveti yalnızca `user.count() === 0` iken üretilir (henüz kimsenin
giremediği bir sistem), ve deploy ile ilk girişin arasına 24 saatlik bir
kısıt koymak kurulumu kırılgan yapar. Kural `createInvite` action'ının
kuralıdır; seed bir action değildir.

`seedBootstrapInvite`'ın doc yorumuna bunu ekle:

```ts
 * Kademe daveti sınırları (tek kullanım + 24 saat) `createInvite` action'ının
 * kuralıdır ve buraya BİLEREK uygulanmaz: kurulum daveti yalnızca boş bir
 * sistemde üretilir ve deploy ile ilk giriş arasına 24 saatlik bir pencere
 * koymak kurulumu kırılgan yapar. Tek kullanım kısıtı ise geçerli —
 * `maxUses: 1` yazılı.
```

- [ ] **Step 7: Doğrula ve commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src tests prisma
git commit -m "feat: kademe daveti tek kullanımlık ve en fazla 24 saat

Davet, kademe dağıtmanın ikinci kapısı: /invite/<token> sayfası oturum
açmış kullanıcıya daveti kendisi için uygulatıyor. Sızan bir ADMIN
bağlantısı tek hesapla ve tek günle sınırlı kalsın.

Kural superRefine'da; formdaki kilit yalnızca kolaylık."
```

---

### Task 5: Davete etiket verilebilir

**Files:**
- Modify: `src/server/invites.ts`
- Modify: `src/app/(app)/admin/create-invite-form.tsx`
- Modify: `src/app/(app)/admin/page.tsx`
- Test: `tests/integration/invite-actions.test.ts`

**Interfaces:**
- Consumes: Task 1'in `Invite.label`
- Produces: `createInvite` girdisine `label: string | null` (varsayılan `null`, ≤ 60 karakter)

- [ ] **Step 1: Başarısız testi yaz**

```ts
  it('etiket davete yazılır', async () => {
    actorRef.current = admin.id

    await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', label: 'Bahar standı',
    })

    expect((await db.invite.findFirstOrThrow()).label).toBe('Bahar standı')
  })

  it('boş etiket null olarak saklanır', async () => {
    actorRef.current = admin.id

    await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', label: '   ',
    })

    expect((await db.invite.findFirstOrThrow()).label).toBeNull()
  })

  it('60 karakterden uzun etiket reddedilir', async () => {
    actorRef.current = admin.id

    const r = await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', label: 'a'.repeat(61),
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('VALIDATION')
  })
```

- [ ] **Step 2: Testi çalıştır, kırmızı olduğunu gör**

Run: `pnpm test tests/integration/invite-actions.test.ts`
Expected: FAIL — `label` her davette null.

- [ ] **Step 3: `createInvite`'a `label` girdisini ekle**

Input şemasına (`superRefine`'dan önceki `z.object` içine):

```ts
    label: z.string().trim().max(60, 'Etiket en fazla 60 karakter olabilir.').nullable().default(null),
```

Handler'daki `db.invite.create` verisine:

```ts
        // Boş/boşluk-dolu etiket null'a düşer: listede "· ·" gibi boş bir
        // ayraç yerine hiç etiket olmaması doğru.
        label: input.label || null,
```

- [ ] **Step 4: Testleri çalıştır**

Run: `pnpm test tests/integration/invite-actions.test.ts`
Expected: PASS

- [ ] **Step 5: Forma etiket alanını ekle**

State: `const [label, setLabel] = useState('')`

Limit alanının yanına:

```tsx
        <div className="space-y-1">
          <Label htmlFor="invite-label">Etiket</Label>
          <Input
            id="invite-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
            placeholder="Bahar standı"
            className="h-8 w-48 text-sm"
          />
        </div>
```

`createInvite` çağrısına `label` eklenir. Gönderim başarılı olunca `setLabel('')`.

- [ ] **Step 6: Etiketi admin listesinde göster**

`admin/page.tsx` — sorgunun `select`/`include`'una `label` zaten geliyor (tam satır çekiliyor). Liste satırı:

```tsx
                <span>
                  {i.label ? `${i.label} · ` : ''}
                  {i.channel?.name ?? 'Kanalsız'} · {inviteStatus(i)}
                </span>
```

- [ ] **Step 7: Doğrula ve commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src tests
git commit -m "feat: davete etiket verilebilsin

Aynı kanala açılmış birden çok bekleyen davet listede birbirinden
ayırt edilemiyordu."
```

---

### Task 6: İptal yerine duraklat / devam

**Files:**
- Modify: `src/server/invites.ts` (`revokeInvite` → `setInviteDisabled`)
- Modify: `src/app/(app)/admin/revoke-invite-button.tsx` → `toggle-invite-button.tsx` (rename)
- Modify: `src/app/(app)/admin/page.tsx`
- Modify: `src/lib/activity-labels.ts`
- Test: `tests/integration/invite-actions.test.ts`, `tests/unit/activity-labels.test.ts`

**Interfaces:**
- Consumes: `Invite.disabledAt` (Task 1)
- Produces: `setInviteDisabled(input: { inviteId: string; disabled: boolean }): Promise<Result<{ id: string; disabled: boolean }>>`; `ToggleInviteButton({ inviteId, disabled }: { inviteId: string; disabled: boolean })`; verb'ler `invite.disabled`, `invite.enabled`

- [ ] **Step 1: Başarısız testleri yaz**

```ts
describe('setInviteDisabled', () => {
  it('daveti duraklatır ve devam ettirir', async () => {
    actorRef.current = admin.id
    const created = await createInvite({ globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER' })
    if (!created.ok) throw new Error('davet üretilemedi')

    const paused = await setInviteDisabled({ inviteId: created.data.id, disabled: true })
    expect(paused.ok).toBe(true)
    expect((await db.invite.findUniqueOrThrow({ where: { id: created.data.id } })).disabledAt).not.toBeNull()

    const resumed = await setInviteDisabled({ inviteId: created.data.id, disabled: false })
    expect(resumed.ok).toBe(true)
    expect((await db.invite.findUniqueOrThrow({ where: { id: created.data.id } })).disabledAt).toBeNull()
  })

  it('her iki yön için activity yazar', async () => {
    actorRef.current = admin.id
    const created = await createInvite({ globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER' })
    if (!created.ok) throw new Error('davet üretilemedi')

    await setInviteDisabled({ inviteId: created.data.id, disabled: true })
    await setInviteDisabled({ inviteId: created.data.id, disabled: false })

    const verbs = (await db.activity.findMany({ where: { entityId: created.data.id }, orderBy: { createdAt: 'asc' } }))
      .map((a) => a.verb)
    expect(verbs).toEqual(['invite.created', 'invite.disabled', 'invite.enabled'])
  })

  it('izinsiz üye daveti duraklatamaz', async () => {
    actorRef.current = admin.id
    const created = await createInvite({ globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER' })
    if (!created.ok) throw new Error('davet üretilemedi')

    const plain = await db.user.create({ data: { name: 'Düz2' } })
    actorRef.current = plain.id

    const r = await setInviteDisabled({ inviteId: created.data.id, disabled: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })
})
```

Dosyanın üstündeki dinamik import satırına `setInviteDisabled` eklenir:

```ts
const { createInvite, setInviteDisabled } = await import('@/server/invites')
```

`tests/unit/activity-labels.test.ts`'e:

```ts
it('davet duraklat/devam fiillerinin Türkçe karşılığı vardır', () => {
  expect(describeActivityVerb('invite.disabled')).toBe('bir daveti duraklattı')
  expect(describeActivityVerb('invite.enabled')).toBe('bir daveti yeniden açtı')
})
```

- [ ] **Step 2: Testleri çalıştır, kırmızı olduklarını gör**

Run: `pnpm test tests/integration/invite-actions.test.ts tests/unit/activity-labels.test.ts`
Expected: FAIL — `setInviteDisabled` export edilmiyor; etiketler yedek metne düşüyor.

- [ ] **Step 3: `revokeInvite`'ı `setInviteDisabled` ile değiştir**

`src/server/invites.ts` sonundaki `revokeInvite` bloğunun yerine:

```ts
/**
 * Daveti kapatır ya da yeniden açar. Kalıcı iptal DEĞİL: çok kullanımlı bir
 * bağlantıyı geçici olarak durdurup devam ettirmek gerekiyor. Kullanılmış
 * slotlar geri gelmez — devam ettirilen davet kalan kontenjanından sürer.
 */
export const setInviteDisabled = defineAction({
  input: z.object({ inviteId: z.string().cuid(), disabled: z.boolean() }),
  getActor,
  authorize: async ({ actor }) => ({ allowed: can(actor, 'invite:revoke', { kind: 'invite' }) }),
  handler: async ({ actor, input }) => {
    await db.invite.update({
      where: { id: input.inviteId },
      data: { disabledAt: input.disabled ? new Date() : null },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: input.disabled ? 'invite.disabled' : 'invite.enabled',
      entityType: 'Invite', entityId: input.inviteId,
    })
    return { id: input.inviteId, disabled: input.disabled }
  },
})
```

- [ ] **Step 4: Activity etiketlerini ekle**

`src/lib/activity-labels.ts` — `'invite.revoked'` satırının **altına**:

```ts
  // 'invite.revoked' kaldırılmadı: kalıcı iptalin yerini duraklat/devam aldı
  // ama geçmiş kayıtlar hâlâ o fiili taşıyor.
  'invite.disabled': 'bir daveti duraklattı',
  'invite.enabled': 'bir daveti yeniden açtı',
```

- [ ] **Step 5: Testleri çalıştır**

Run: `pnpm test tests/integration/invite-actions.test.ts tests/unit/activity-labels.test.ts`
Expected: PASS

- [ ] **Step 6: Butonu toggle'a çevir**

```bash
git mv "src/app/(app)/admin/revoke-invite-button.tsx" "src/app/(app)/admin/toggle-invite-button.tsx"
```

Dosyanın tamamı:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setInviteDisabled } from '@/server/invites'
import { Button } from '@/components/ui/button'

export function ToggleInviteButton({
  inviteId,
  disabled,
}: {
  inviteId: string
  disabled: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleToggle() {
    setError(null)
    startTransition(async () => {
      const result = await setInviteDisabled({ inviteId, disabled: !disabled })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" size="xs" disabled={pending} onClick={handleToggle}>
        {disabled ? 'Devam ettir' : 'Duraklat'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}
```

- [ ] **Step 7: Listede butonu bağla**

`admin/page.tsx` — import `ToggleInviteButton`. Buton koşulu değişir: duraklatılmış davetler de buton görmeli, süresi dolmuş/kontenjanı dolmuş olanlar görmemeli.

```tsx
function canToggle(invite: InviteRow): boolean {
  const status = inviteStatus(invite)
  return status === 'bekliyor' || status === 'duraklatıldı'
}
```

`isPending` yardımcısı kaldırılır, satırdaki kullanım:

```tsx
                {canToggle(i) && (
                  <ToggleInviteButton inviteId={i.id} disabled={i.disabledAt !== null} />
                )}
```

- [ ] **Step 8: Doğrula ve commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src tests
git commit -m "feat: davet iptali duraklat/devam olsun

Kalıcı revoke, çok kullanımlı bir bağlantıyı geçici olarak durdurmanın
yolunu bırakmıyordu. invite.revoked fiili sözlükte kalıyor: geçmiş
kayıtlar hâlâ onu taşıyor."
```

---

### Task 7: Admin listesi kullanımları gösterir

**Files:**
- Modify: `src/app/(app)/admin/page.tsx`
- Test: `tests/e2e/invite-flow.spec.ts` (yeni test)

**Interfaces:**
- Consumes: Task 1 `redemptions`, Task 5 `label`, Task 6 `ToggleInviteButton`
- Produces: yok

- [ ] **Step 1: Sorguyu kullanan bilgisiyle genişlet**

```ts
      include: {
        channel: { select: { name: true } },
        redemptions: {
          where: { redeemedAt: { not: null } },
          orderBy: { redeemedAt: 'asc' },
          select: { redeemedAt: true, user: { select: { name: true } } },
        },
      },
```

`InviteRow` tipi bu şekle uyar:

```tsx
type InviteRow = {
  maxUses: number | null
  expiresAt: Date | null
  disabledAt: Date | null
  redemptions: { redeemedAt: Date | null; user: { name: string } | null }[]
}
```

> Sorgu `where` ile yalnızca tüketilmiş satırları çektiği için `usedCount` artık uzunluğun kendisidir; `filter` kalkar:
> ```tsx
> function usedCount(invite: InviteRow): number {
>   return invite.redemptions.length
> }
> ```

- [ ] **Step 2: Satırı kullanım sayısı ve isimlerle yeniden yaz**

```tsx
function usageText(invite: InviteRow): string {
  const used = usedCount(invite)
  return invite.maxUses === null ? `${used} kullanım` : `${used}/${invite.maxUses} kullanıldı`
}
```

Liste öğesi:

```tsx
              <li key={i.id} className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <p>
                    {i.label ? `${i.label} · ` : ''}
                    {i.channel?.name ?? 'Kanalsız'} · {usageText(i)} · {inviteStatus(i)}
                  </p>
                  {i.redemptions.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {i.redemptions.map((r) => r.user?.name ?? 'Silinmiş üye').join(', ')}
                    </p>
                  )}
                </div>
                {canToggle(i) && (
                  <ToggleInviteButton inviteId={i.id} disabled={i.disabledAt !== null} />
                )}
              </li>
```

- [ ] **Step 3: E2E testi yaz**

`tests/e2e/invite-flow.spec.ts` sonuna:

```ts
test('çok kullanımlı davet listede kullanım sayısıyla görünür', async ({ page }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const admin = await db.user.create({
    data: { name: 'Admin', email: `a-${stamp}@x.com`, globalRole: 'ADMIN', onboardedAt: new Date() },
  })
  const { tokenHash } = createInviteToken()
  const invite = await db.invite.create({
    data: {
      tokenHash,
      label: `Stand ${stamp}`,
      maxUses: 2,
      expiresAt: new Date(Date.now() + 864e5),
      createdById: admin.id,
    },
  })
  const joined = await db.user.create({
    data: { name: `Katılan ${stamp}`, email: `k-${stamp}@x.com`, onboardedAt: new Date() },
  })
  await db.inviteRedemption.create({
    data: { inviteId: invite.id, userId: joined.id, redeemedAt: new Date() },
  })

  await signInAs(page.context(), admin.id)
  await page.goto('/admin')

  await expect(page.getByText(`Stand ${stamp}`)).toContainText('1/2 kullanıldı')
  await expect(page.getByText(`Katılan ${stamp}`)).toBeVisible()
})
```

Spec'in başına import eklenir (yardımcı zaten var, `authorization.spec.ts` de onu kullanıyor):

```ts
import { signInAs } from './helpers/session'
```

- [ ] **Step 4: E2E'yi çalıştır**

Run: `pnpm test:e2e tests/e2e/invite-flow.spec.ts`
Expected: PASS

> **Tuzak:** Arka planda `pnpm dev` açıksa her spec login sayfasında kalır. Portu 3100 ve 1234'ü (collab) kontrol et.

- [ ] **Step 5: Doğrula ve commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm test:e2e`

```bash
git add src tests
git commit -m "feat: admin listesi davet kullanımlarını göstersin

Etiket, x/y kullanım sayısı ve katılanların isimleri. Çok kullanımlı
davette 'kullanıldı: <tek isim>' artık yetersizdi."
```

---

### Task 8: `/invite/[token]` gerekçeli mesaj verir

**Files:**
- Modify: `src/app/invite/[token]/page.tsx`
- Test: `tests/e2e/invite-flow.spec.ts`

**Interfaces:**
- Consumes: Task 1 alanları
- Produces: yok

- [ ] **Step 1: Başarısız E2E testlerini yaz**

```ts
test('duraklatılmış davet gerekçesiyle reddedilir', async ({ page }) => {
  const { token, tokenHash } = createInviteToken()
  await db.invite.create({
    data: { tokenHash, expiresAt: new Date(Date.now() + 864e5), disabledAt: new Date() },
  })

  await page.goto(`/invite/${token}`)
  await expect(page.getByText('Bu davet şu anda kapalı')).toBeVisible()
})

test('kontenjanı dolmuş davet gerekçesiyle reddedilir', async ({ page }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const { token, tokenHash } = createInviteToken()
  const invite = await db.invite.create({
    data: { tokenHash, expiresAt: new Date(Date.now() + 864e5), maxUses: 1 },
  })
  const user = await db.user.create({
    data: { name: 'Dolduran', email: `d-${stamp}@x.com` },
  })
  await db.inviteRedemption.create({
    data: { inviteId: invite.id, userId: user.id, redeemedAt: new Date() },
  })

  await page.goto(`/invite/${token}`)
  await expect(page.getByText('kontenjanı doldu')).toBeVisible()
})
```

Mevcut "süresi dolmuş davet" testinin beklentisi `Davet geçersiz` yerine `süresi doldu` metnine güncellenir.

- [ ] **Step 2: Testleri çalıştır, kırmızı olduklarını gör**

Run: `pnpm test:e2e tests/e2e/invite-flow.spec.ts`
Expected: FAIL — hepsi tek "Davet geçersiz" mesajını gösteriyor.

- [ ] **Step 3: Gerekçe ayrımını uygula**

`src/app/invite/[token]/page.tsx` — `invalid` bloğunun yerine:

```tsx
  /**
   * Tek "geçersiz" mesajı yeterliydi, artık değil: çok kullanımlı ve
   * duraklatılabilir davetlerde davetlinin ne yapması gerektiği sebebe
   * göre değişiyor (bekle / yönetime sor / yeni link iste).
   */
  function invalidReason(): string | null {
    if (!invite) return 'Bu bağlantı geçersiz. Kulüp yönetiminden yeni bir link iste.'
    if (invite.disabledAt) return 'Bu davet şu anda kapalı. Kulüp yönetimine sor.'
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return 'Bu davetin süresi doldu. Kulüp yönetiminden yeni bir link iste.'
    }
    if (invite.maxUses !== null && invite.redemptions.length >= invite.maxUses) {
      return 'Bu davetin kontenjanı doldu. Kulüp yönetiminden yeni bir link iste.'
    }
    return null
  }

  const reason = invalidReason()
  if (reason) {
    return (
      <AuthShell>
        <div className="space-y-6 text-center">
          <AuthHeading icon={AlertTriangle} tone="destructive" title="Davet kullanılamıyor">
            {failed
              ? 'Davet kullanılamadı. Bu sırada başkası kullanmış ya da kapatılmış olabilir.'
              : reason}
          </AuthHeading>
        </div>
      </AuthShell>
    )
  }
```

- [ ] **Step 4: Zaten kullanmış kullanıcıyı ayır**

`getActor()` bloğunun başına, onay formundan önce:

```tsx
  const actor = await getActor()
  if (actor) {
    // Daveti zaten kullanmış: onay formu göstermek yanıltıcı olurdu, kabul
    // etse de yeni bir slot yakmayacak (consumeInvite idempotent).
    const already = await db.inviteRedemption.findUnique({
      where: { inviteId_userId: { inviteId: invite.id, userId: actor.id } },
    })
    if (already) redirect('/')
```

- [ ] **Step 5: E2E'yi çalıştır**

Run: `pnpm test:e2e tests/e2e/invite-flow.spec.ts`
Expected: PASS

- [ ] **Step 6: Tam doğrulama ve commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm test:e2e`

```bash
git add src tests
git commit -m "feat: davet sayfası neden kullanılamadığını söylesin

Tek 'geçersiz' mesajı yeterliydi; duraklatılabilir ve kontenjanlı
davetlerde davetlinin ne yapması gerektiği sebebe göre değişiyor."
```

---

## Kapanış kontrolü

Tüm görevler bittiğinde:

- [ ] `pnpm typecheck` — sıfır hata
- [ ] `pnpm test` — hepsi geçer
- [ ] `pnpm lint` — temiz
- [ ] `pnpm test:e2e` — hepsi geçer (`pnpm dev` KAPALI, port 3100 ve 1234 boş)
- [ ] `pnpm db:seed` boş bir veritabanında çalışır, kurulum daveti üretir
- [ ] `pnpm invite:create` çalışır, bağlantı basar
- [ ] Elle: admin panelinden 2 kullanımlık, 1 günlük, etiketli davet üret → listede `0/2 kullanıldı` → duraklat → `/invite/<token>` "kapalı" der → devam ettir → kullanılabilir
