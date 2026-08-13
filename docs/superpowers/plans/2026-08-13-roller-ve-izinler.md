# Roller ve İzinler — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kulüp geneli izin taşıyan, panelden yönetilen bir rol sistemi eklemek — böylece Yönetim Kurulu tüm koordinatörlükleri görebilsin ve yönetime özel kanal açılabilsin.

**Architecture:** Rol ve kanal iki ayrı eksen olarak durur. `ChannelMember` (hangi koordinatörlüktesin) değişmez; yanına `Role` + `UserRole` (kulüpte hangi kademedesin) eklenir. Rollerin izinleri `Actor.permissions` içinde düzleşir ve `can()` içindeki mevcut `isAdmin(actor)` dallarının yerini `has(actor, IZIN)` alır. `globalRole` üç değerli olur: `SUPERADMIN` (rol/izin dağıtan sistem sahibi) > `ADMIN` (Başkan) > `MEMBER`.

**Tech Stack:** Next.js 16.3, React 19.2, TypeScript strict, Prisma 6.19 + PostgreSQL 16, Zod 4, Vitest 4, Playwright 1.62, Tailwind 4 + shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-08-13-roller-ve-izinler-design.md](../specs/2026-08-13-roller-ve-izinler-design.md)

## Global Constraints

- **Arayüz dili Türkçe.** Ham enum adı (`CONTENT_READ_ALL`) kullanıcıya asla gösterilmez; `src/lib/permission-labels.ts` üzerinden geçer. Veritabanında saklanan değer İngilizce kalır (`activity-labels.ts:16-27` deseni).
- **Yetki kontrolü veriye dokunmadan önce.** Her server action `defineAction`'ın `authorize` kancasından geçer; `authorize` handler'dan önce çalışır ve bu sıra değiştirilemez (`action.ts:54`).
- **UI'da gizlemek yetkilendirme değildir.** Butonu/sayfayı gizlemek gerekli ama yeterli değil; sunucu tarafı kontrol her zaman ayrıca yapılır.
- **`notFound()` çağıran route'lara `loading.tsx` eklenmez.** Suspense sınırı 200'ü akıtıp durumu kilitler (`admin/page.tsx:25-28`, yaşanmış defekt).
- **Sorgu dosyaları (`*-query.ts`) `'use server'` TAŞIMAZ.** Aksi halde her export edilen fonksiyon herkese açık bir RPC olur ve çağıran `actor` nesnesini kendisi uydurabilir (`channels-query.ts:1-11`).
- **Testler ayrı veritabanında koşar** (`tests/helpers/test-database-url.ts`). `resetDb()` tablo listesini `pg_tables`'tan okur — yeni model eklerken orada yapılacak bir şey yok.
- Komutlar: `pnpm typecheck` · `pnpm lint` · `pnpm vitest run <yol>` · `pnpm test` · `pnpm test:e2e`. Prisma CLI `.env.local` okur (`prisma.config.ts`).
- **`pnpm test:e2e` çalıştırmadan önce `pnpm dev` KAPALI olmalı.** Açık bir dev sunucusu her Playwright spec'ini login sayfasında düşürür.

---

### Task 1: Şema ve göç

**Files:**
- Modify: `prisma/schema.prisma` (satır 16-19 `GlobalRole`, satır 88-126 `User`)
- Create: `prisma/migrations/<ts>_add_superadmin_enum_value/migration.sql`
- Create: `prisma/migrations/<ts>_roles/migration.sql`
- Create: `prisma/migrations/<ts>_promote_superadmin/migration.sql`
- Test: `tests/integration/roles-schema.test.ts`

**Interfaces:**
- Produces: `Permission` enum (9 değer), `Role` ve `UserRole` modelleri, `GlobalRole.SUPERADMIN`. Sonraki tüm task'lar `db.role`, `db.userRole` ve `user.roles` ilişkisine dayanır.

- [ ] **Step 1: Write the failing test**

`tests/integration/roles-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

beforeEach(async () => {
  await resetDb()
})

describe('rol şeması', () => {
  it('rolü izinleriyle birlikte saklar', async () => {
    const role = await db.role.create({
      data: {
        name: 'Yönetim Kurulu',
        slug: 'yonetim-kurulu',
        position: 1,
        isSystem: true,
        permissions: ['CONTENT_READ_ALL', 'BUDGET_READ_ALL'],
      },
    })

    expect(role.permissions).toEqual(['CONTENT_READ_ALL', 'BUDGET_READ_ALL'])
    expect(role.color).toBeNull()
    expect(role.isSystem).toBe(true)
  })

  it('izinsiz rol boş dizi ile açılır', async () => {
    const role = await db.role.create({
      data: { name: 'Aktif Üye', slug: 'aktif-uye', position: 2 },
    })
    expect(role.permissions).toEqual([])
    expect(role.isSystem).toBe(false)
  })

  it('aynı kullanıcıya aynı rolü iki kez veremez', async () => {
    const user = await db.user.create({ data: { name: 'Efe' } })
    const role = await db.role.create({
      data: { name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1 },
    })
    await db.userRole.create({ data: { userId: user.id, roleId: role.id } })

    await expect(
      db.userRole.create({ data: { userId: user.id, roleId: role.id } }),
    ).rejects.toThrow()
  })

  it('kullanıcı silinince rol ataması da silinir', async () => {
    const user = await db.user.create({ data: { name: 'Efe' } })
    const role = await db.role.create({
      data: { name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1 },
    })
    await db.userRole.create({ data: { userId: user.id, roleId: role.id } })

    await db.user.delete({ where: { id: user.id } })

    expect(await db.userRole.count()).toBe(0)
  })

  it('rolü veren kişi silinince atama kalır, grantedById boşalır', async () => {
    const user = await db.user.create({ data: { name: 'Efe' } })
    const granter = await db.user.create({ data: { name: 'Başkan' } })
    const role = await db.role.create({
      data: { name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1 },
    })
    await db.userRole.create({
      data: { userId: user.id, roleId: role.id, grantedById: granter.id },
    })

    await db.user.delete({ where: { id: granter.id } })

    const assignment = await db.userRole.findFirstOrThrow({ where: { userId: user.id } })
    expect(assignment.grantedById).toBeNull()
  })

  it('SUPERADMIN global rolünü kabul eder', async () => {
    const user = await db.user.create({ data: { name: 'Sahip', globalRole: 'SUPERADMIN' } })
    expect(user.globalRole).toBe('SUPERADMIN')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/roles-schema.test.ts`
Expected: FAIL — `db.role` tanımlı değil (`Property 'role' does not exist on type 'PrismaClient'`).

- [ ] **Step 3: `GlobalRole` enum'una SUPERADMIN ekle**

`prisma/schema.prisma` satır 16-19'u değiştir:

```prisma
enum GlobalRole {
  SUPERADMIN
  ADMIN
  MEMBER
}
```

- [ ] **Step 4: Enum migration'ını TEK BAŞINA üret ve düzelt**

```bash
pnpm prisma migrate dev --create-only --name add_superadmin_enum_value
```

Üretilen `migration.sql` dosyasını aç ve içeriğinin **yalnızca** şu olduğundan emin ol (Prisma `BEFORE` yan tümcesini yazmaz, elle ekle):

```sql
-- SUPERADMIN, ADMIN'in ÜSTÜNDE bir kademe; enum sırası bunu yansıtsın.
--
-- Bu migration BİLEREK yalnız bırakıldı. Postgres 16 `ALTER TYPE ... ADD VALUE`
-- komutunu transaction içinde kabul eder ama eklenen değeri AYNI transaction'da
-- kullanmaya izin vermez. Prisma her migration dosyasını tek transaction'da
-- çalıştırdığı için, bu dosyaya bir `UPDATE ... = 'SUPERADMIN'` eklenirse
-- migration `unsafe use of new value of enum type` hatasıyla patlar.
-- Veri güncellemesi ayrı bir migration'da (promote_superadmin) durur.
ALTER TYPE "GlobalRole" ADD VALUE 'SUPERADMIN' BEFORE 'ADMIN';
```

Uygula:

```bash
pnpm prisma migrate dev
```

- [ ] **Step 5: `Permission`, `Role`, `UserRole` modellerini ekle**

`prisma/schema.prisma`'da `GlobalRole` enum'undan sonra:

```prisma
enum Permission {
  CONTENT_READ_ALL
  CONTENT_WRITE_ALL
  BUDGET_READ_ALL
  BUDGET_WRITE_ALL
  MEMBER_MANAGE
  INVITE_MANAGE
  CHANNEL_CREATE
  CHANNEL_MANAGE_ALL
  TRASH_MANAGE
}
```

Dosyanın sonuna:

```prisma
// Kulüp geneli kademe: "hangi koordinatörlüktesin" sorusunu ChannelMember
// cevaplar, "kulüpte hangi yetkilerdesin" sorusunu bu tablo cevaplar.
// İzin KATALOĞU koddadır (Permission enum); ayarlanabilir olan, rolün hangi
// izinleri taşıdığıdır. Kodda kontrol edilmeyen bir izin yalandır.
model Role {
  id          String       @id @default(cuid())
  name        String       @unique
  slug        String       @unique
  color       String?
  permissions Permission[]
  isSystem    Boolean      @default(false)
  // Yalnızca rozet sıralaması için. Yetki hiyerarşisi DEĞİL — rol
  // düzenleyebilen tek aktör (SUPERADMIN) zaten her izne sahip.
  position    Int          @unique
  createdAt   DateTime     @default(now())

  members UserRole[]
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

`User` modeline (satır 105-124 arasındaki ilişki bloğuna) iki satır ekle:

```prisma
  roles          UserRole[]
  grantedRoles   UserRole[]      @relation("RoleGrantedBy")
```

- [ ] **Step 6: Rol migration'ını üret ve uygula**

```bash
pnpm prisma migrate dev --name roles
```

Üretilen SQL'de `CREATE TYPE "Permission"`, `CREATE TABLE "Role"`, `CREATE TABLE "UserRole"` ve üç foreign key olduğunu doğrula.

- [ ] **Step 7: Veri göçü migration'ını elle yaz**

```bash
pnpm prisma migrate dev --create-only --name promote_superadmin
```

Prisma şema farkı olmadığı için boş bir dosya üretir. İçine yaz:

```sql
-- Kurulum daveti ile giren ilk ADMIN, sistemin sahibidir. Bu adım atlanırsa
-- sistemde hiç SUPERADMIN kalmaz ve rol paneli kimseye açılmaz.
UPDATE "User" SET "globalRole" = 'SUPERADMIN'
WHERE id = (
  SELECT id FROM "User"
  WHERE "globalRole" = 'ADMIN'
  ORDER BY "joinedAt" ASC
  LIMIT 1
);
```

Uygula:

```bash
pnpm prisma migrate dev
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/roles-schema.test.ts`
Expected: PASS — 6 test.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/integration/roles-schema.test.ts
git commit -m "feat: add Role and UserRole models with a SUPERADMIN tier"
```

---

### Task 2: `Actor.permissions` ve `has()`

**Files:**
- Modify: `src/lib/auth/policy.ts:1-11` (tipler), yeni `has()` ve `flattenPermissions()`
- Modify: `src/lib/auth/session.ts:6-34`
- Modify: `collab/src/auth.ts:6-48`
- Modify: `src/server/entity-access.ts:139-153`
- Create: `tests/helpers/make-actor.ts`
- Modify: `tests/unit/policy.test.ts:4-20` ve 12 entegrasyon test dosyasının `getActor` mock'u
- Test: `tests/unit/role-policy.test.ts`

**Interfaces:**
- Consumes: Task 1'in `Permission` enum'u.
- Produces:
  - `type Permission = 'CONTENT_READ_ALL' | 'CONTENT_WRITE_ALL' | 'BUDGET_READ_ALL' | 'BUDGET_WRITE_ALL' | 'MEMBER_MANAGE' | 'INVITE_MANAGE' | 'CHANNEL_CREATE' | 'CHANNEL_MANAGE_ALL' | 'TRASH_MANAGE'`
  - `type GlobalRole = 'SUPERADMIN' | 'ADMIN' | 'MEMBER'`
  - `Actor.permissions: Permission[]` (**zorunlu alan**)
  - `has(actor: Actor, permission: Permission): boolean`
  - `flattenPermissions(roles: { role: { permissions: Permission[] } }[]): Permission[]`
  - `makeActor(overrides: Partial<Actor> & { id: string }): Actor` (testler için)

- [ ] **Step 1: Write the failing test**

`tests/unit/role-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { flattenPermissions, has } from '@/lib/auth/policy'
import { makeActor } from '../helpers/make-actor'

describe('has()', () => {
  it('izni olan rolü taşıyan üye o izne sahiptir', () => {
    const actor = makeActor({ id: 'yk', permissions: ['CONTENT_READ_ALL'] })
    expect(has(actor, 'CONTENT_READ_ALL')).toBe(true)
  })

  it('taşımadığı izne sahip değildir', () => {
    const actor = makeActor({ id: 'yk', permissions: ['CONTENT_READ_ALL'] })
    expect(has(actor, 'BUDGET_WRITE_ALL')).toBe(false)
  })

  it('ADMIN ve SUPERADMIN her izni kapsar', () => {
    for (const globalRole of ['ADMIN', 'SUPERADMIN'] as const) {
      const actor = makeActor({ id: 'x', globalRole, permissions: [] })
      expect(has(actor, 'TRASH_MANAGE')).toBe(true)
      expect(has(actor, 'BUDGET_WRITE_ALL')).toBe(true)
    }
  })

  // policy.ts'in en üstündeki tek mutlak kural burada da geçerli olmalı:
  // pasife alınmış bir kişinin rolleri hâlâ tabloda duruyor olabilir.
  it('pasif kullanıcı hiçbir izne sahip değildir', () => {
    const passiveAdmin = makeActor({ id: 'a', globalRole: 'ADMIN', isActive: false })
    const passiveWithRole = makeActor({
      id: 'b', isActive: false, permissions: ['CONTENT_READ_ALL'],
    })
    expect(has(passiveAdmin, 'CONTENT_READ_ALL')).toBe(false)
    expect(has(passiveWithRole, 'CONTENT_READ_ALL')).toBe(false)
  })
})

describe('flattenPermissions()', () => {
  it('birden çok rolün izinlerini birleştirir', () => {
    const result = flattenPermissions([
      { role: { permissions: ['CONTENT_READ_ALL', 'INVITE_MANAGE'] } },
      { role: { permissions: ['BUDGET_READ_ALL'] } },
    ])
    expect(result.sort()).toEqual(['BUDGET_READ_ALL', 'CONTENT_READ_ALL', 'INVITE_MANAGE'])
  })

  it('aynı izni iki rolden alan kullanıcıda tekrar üretmez', () => {
    const result = flattenPermissions([
      { role: { permissions: ['CONTENT_READ_ALL'] } },
      { role: { permissions: ['CONTENT_READ_ALL'] } },
    ])
    expect(result).toEqual(['CONTENT_READ_ALL'])
  })

  it('rolsüz kullanıcıda boş dizi döner', () => {
    expect(flattenPermissions([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/role-policy.test.ts`
Expected: FAIL — `has` ve `flattenPermissions` `@/lib/auth/policy` içinde yok.

- [ ] **Step 3: `policy.ts`'e tipleri ve iki fonksiyonu ekle**

`src/lib/auth/policy.ts` satır 1-11'i değiştir:

```ts
export type GlobalRole = 'SUPERADMIN' | 'ADMIN' | 'MEMBER'
export type ChannelRole = 'LEAD' | 'MEMBER'
export type Visibility = 'OPEN' | 'PRIVATE'
export type DocumentVisibility = 'PUBLIC' | 'CHANNEL' | 'PRIVATE'

export type Permission =
  | 'CONTENT_READ_ALL'
  | 'CONTENT_WRITE_ALL'
  | 'BUDGET_READ_ALL'
  | 'BUDGET_WRITE_ALL'
  | 'MEMBER_MANAGE'
  | 'INVITE_MANAGE'
  | 'CHANNEL_CREATE'
  | 'CHANNEL_MANAGE_ALL'
  | 'TRASH_MANAGE'

export type Actor = {
  id: string
  globalRole: GlobalRole
  isActive: boolean
  memberships: { channelId: string; channelRole: ChannelRole }[]
  // ZORUNLU alan, opsiyonel değil. collab/src/auth.ts kendi aktörünü ayrı
  // kuruyor; alan opsiyonel olsaydı orası sessizce "hiç izni yok" ile
  // çalışırdı — YK üyesi dokümanı uygulamada açar, collab bağlantısı
  // reddedilirdi. Zorunluluk, tsc'yi her kurulum noktasında hataya düşürür.
  permissions: Permission[]
}
```

Ardından `isAdmin` yardımcısının (satır 72-74) yanına ekle:

```ts
function isAdmin(actor: Actor) {
  // SUPERADMIN, ADMIN'in yapabildiği her şeyi yapar.
  return actor.globalRole !== 'MEMBER'
}

/**
 * İzin sorgusunun tek kapısı. ADMIN ve SUPERADMIN'in "her izne sahip olması"
 * yalnızca burada yazılıdır; çağıranlar ayrıca globalRole kontrol etmez.
 */
export function has(actor: Actor, permission: Permission): boolean {
  if (!actor.isActive) return false
  if (isAdmin(actor)) return true
  return actor.permissions.includes(permission)
}

/**
 * Kullanıcının rollerinin izinlerini tekrarsız tek bir listeye indirger.
 * Üç ayrı yerde aktör kurulduğu için (session.ts, collab/src/auth.ts,
 * entity-access.ts) burada, saf bir fonksiyon olarak durur.
 */
export function flattenPermissions(
  roles: { role: { permissions: Permission[] } }[],
): Permission[] {
  return [...new Set(roles.flatMap((assignment) => assignment.role.permissions))]
}
```

- [ ] **Step 4: `makeActor` fabrikasını yaz**

`tests/helpers/make-actor.ts`:

```ts
import type { Actor } from '@/lib/auth/policy'

/**
 * Testlerde aktör kurmanın tek yolu. `Actor` yeni bir alan kazandığında
 * yüzlerce test nesnesi değil, yalnızca bu varsayılan güncellenir.
 */
export function makeActor(overrides: Partial<Actor> & { id: string }): Actor {
  return {
    globalRole: 'MEMBER',
    isActive: true,
    memberships: [],
    permissions: [],
    ...overrides,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/role-policy.test.ts`
Expected: PASS — 7 test.

- [ ] **Step 6: Derleyiciye kalan kurulum noktalarını saydır**

Run: `pnpm typecheck`
Expected: FAIL. `permissions` zorunlu olduğu için her `Actor` kurulumu hata verir. Çıkan liste bu adımın kontrol listesidir; en az şunlar görünmeli: `src/lib/auth/session.ts`, `collab/src/auth.ts`, `src/server/entity-access.ts`, `tests/unit/policy.test.ts`.

- [ ] **Step 7: `session.ts`'i rolleri yükleyecek şekilde güncelle**

`src/lib/auth/session.ts` tamamı:

```ts
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/config'
import { db } from '@/lib/db'
import { flattenPermissions, type Actor, type ChannelRole, type GlobalRole, type Permission } from '@/lib/auth/policy'

type UserWithRoles = {
  id: string
  globalRole: GlobalRole
  isActive: boolean
  memberships: { channelId: string; channelRole: ChannelRole }[]
  roles: { role: { permissions: Permission[] } }[]
}

export function toActor(user: UserWithRoles): Actor {
  return {
    id: user.id,
    globalRole: user.globalRole,
    isActive: user.isActive,
    memberships: user.memberships.map((m) => ({
      channelId: m.channelId,
      channelRole: m.channelRole,
    })),
    permissions: flattenPermissions(user.roles),
  }
}

export async function getActor(): Promise<Actor | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  // İzinler token'da DEĞİL, her istekte veritabanından okunur: geri alınan
  // bir rol anında etkisini gösterir, oturum ömrü boyunca geçerli kalmaz.
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      memberships: true,
      roles: { select: { role: { select: { permissions: true } } } },
    },
  })
  if (!user || !user.isActive) return null
  return toActor(user)
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor()
  if (!actor) redirect('/login')
  return actor
}
```

- [ ] **Step 8: `collab/src/auth.ts`'i güncelle**

`collab/src/auth.ts` satır 6-11 ve 29-48:

```ts
import { flattenPermissions, type Actor } from '../../src/lib/auth/policy.ts'
import { verifyCollabToken } from '../../src/lib/auth/collab-token.ts'
import { PrismaClient } from '../generated/prisma/client.js'

const db = new PrismaClient()

// Ana uygulamanın Actor tipiyle AYNI olmak zorunda: authorize-document.ts
// bunu doğrudan can()'e geçiriyor. Ayrı bir tip tutmak, alan eklendiğinde
// sessizce eksik aktör üretme riskidir.
export type CollabActor = Actor
```

`resolveActor` gövdesi:

```ts
export async function resolveActor(token: string | null): Promise<CollabActor | null> {
  const userId = verifyCollabToken(token, authSecret())
  if (!userId) return null

  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      memberships: true,
      roles: { select: { role: { select: { permissions: true } } } },
    },
  })
  if (!user || !user.isActive) return null

  return {
    id: user.id,
    globalRole: user.globalRole,
    isActive: user.isActive,
    memberships: user.memberships.map((m) => ({
      channelId: m.channelId,
      channelRole: m.channelRole,
    })),
    permissions: flattenPermissions(user.roles),
  }
}
```

- [ ] **Step 9: collab tarafını doğrula**

`collab/tests/auth.test.ts` sonuna ekle (dosya kendi `db`, `makeToken`, `owner`, `outsider`, `channelId` kurulumunu kullanıyor):

```ts
describe('rol izinleri collab tarafında', () => {
  it('CONTENT_WRITE_ALL taşıyan üye, kanala üye olmadan dokümana bağlanabilir', async () => {
    const role = await db.role.create({
      data: {
        name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1,
        permissions: ['CONTENT_READ_ALL', 'CONTENT_WRITE_ALL'],
      },
    })
    await db.userRole.create({ data: { userId: outsider.id, roleId: role.id } })
    const doc = await db.document.create({
      data: { title: 'Not', channelId, createdById: owner.id },
    })

    const r = await authorizeDocument(makeToken(outsider.id), doc.id)

    expect(r).toEqual({ ok: true, actorId: outsider.id })
  })

  it('rolsüz yabancı aynı dokümana bağlanamaz', async () => {
    const doc = await db.document.create({
      data: { title: 'Not', channelId, createdById: owner.id },
    })

    const r = await authorizeDocument(makeToken(outsider.id), doc.id)

    expect(r).not.toEqual({ ok: true, actorId: outsider.id })
  })
})
```

Çalıştır:

```bash
cd collab && pnpm typecheck && pnpm test && cd ..
```
Expected: PASS. Bu test, `resolveActor`'ün rolleri gerçekten yüklediğinin tek kanıtı — `permissions` alanı zorunlu olduğu için derleyici eksikliği yakalar ama boş dizi döndürmeyi yakalamaz.

- [ ] **Step 10: `entity-access.ts`'i güncelle**

`src/server/entity-access.ts` satır 139-153:

```ts
  const users = await db.user.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true, globalRole: true, isActive: true, memberships: true,
      roles: { select: { role: { select: { permissions: true } } } },
    },
    orderBy: { name: 'asc' },
  })

  const allowed: { id: string; name: string }[] = []
  for (const user of users) {
    const actor: Actor = {
      id: user.id,
      globalRole: user.globalRole,
      isActive: user.isActive,
      memberships: user.memberships.map((m) => ({
        channelId: m.channelId,
        channelRole: m.channelRole,
      })),
      permissions: flattenPermissions(user.roles),
    }
```

Üstteki import satırını da güncelle:

```ts
import { can, flattenPermissions, type Actor } from '@/lib/auth/policy'
```

- [ ] **Step 11: `policy.test.ts`'i fabrikaya geçir**

`tests/unit/policy.test.ts` satır 1-20:

```ts
import { describe, expect, it } from 'vitest'
import { type Resource, can } from '@/lib/auth/policy'
import { makeActor } from '../helpers/make-actor'

const admin = makeActor({ id: 'admin', globalRole: 'ADMIN' })
const lead = makeActor({
  id: 'lead', memberships: [{ channelId: 'c1', channelRole: 'LEAD' }],
})
const member = makeActor({
  id: 'member', memberships: [{ channelId: 'c1', channelRole: 'MEMBER' }],
})
const outsider = makeActor({
  id: 'outsider', memberships: [{ channelId: 'c2', channelRole: 'MEMBER' }],
})
const inactive = makeActor({ ...member, id: 'inactive', isActive: false })
```

Dosyanın geri kalanı değişmez.

- [ ] **Step 12: Entegrasyon testlerinin `getActor` mock'unu güncelle**

Şu 12 dosyada `vi.mock('@/lib/auth/session', ...)` bloğu var: `tests/unit/action.test.ts`, `tests/integration/{profile,comments,notifications,documents,members,budget,events,tasks,search,sponsors,channels}.test.ts`.

`tests/unit/action.test.ts` dışındaki 11 dosyada mock gövdesini şu hale getir (`members.test.ts:6-18` örneği):

```ts
const actorRef: { current: string | null } = { current: null }
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () => {
    if (!actorRef.current) return null
    const user = await db.user.findUniqueOrThrow({
      where: { id: actorRef.current },
      include: {
        memberships: true,
        roles: { select: { role: { select: { permissions: true } } } },
      },
    })
    return {
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
      permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions))],
    }
  },
}))
```

**Dikkat:** `actorRef`'in şekli dosyadan dosyaya değişiyor — `members.test.ts`'te `{ current: string | null }`, `comments.test.ts`'te `{ current: { id: string } | null }` (kullanımı `actorRef.current = { id: other.id }`). Yalnızca `include` ve `permissions` satırlarını ekle, `where` ifadesine dokunma.

`comments.test.ts` ayrıca aynı aktörü ikinci kez kuran bir `actorOf(id)` yardımcısı taşıyor (satır 32-39) — oraya da aynı iki satır eklenmeli, yoksa o yolla kurulan aktör izinsiz kalır.

`tests/unit/action.test.ts` veritabanına gitmiyor; oradaki sahte aktöre yalnızca `permissions: []` eklemek yeterli.

- [ ] **Step 13: Doğrula**

```bash
pnpm typecheck && pnpm lint && pnpm test
```
Expected: typecheck temiz, lint temiz, tüm testler PASS. Davranış hiç değişmedi — bu task yalnızca alanı taşıdı.

- [ ] **Step 14: Commit**

```bash
git add src/lib/auth/policy.ts src/lib/auth/session.ts src/server/entity-access.ts collab/src/auth.ts tests/
git commit -m "feat: carry role permissions on Actor and add has()"
```

---

### Task 3: `can()` içindeki admin dallarını izne çevir

**Files:**
- Modify: `src/lib/auth/policy.ts:76-208` (`can()` gövdesi)
- Modify: `tests/unit/policy.test.ts` (yeni describe bloğu)

**Interfaces:**
- Consumes: `has()`, `Permission` (Task 2).
- Produces: `can()` artık izin taşıyan MEMBER'lar için de doğru cevap verir. Davranış değişimi: `CONTENT_READ_ALL` taşıyan üye tüm PRIVATE kanal içeriğini okur.

- [ ] **Step 1: Write the failing test**

`tests/unit/policy.test.ts` sonuna ekle:

```ts
describe('can() — rol izinleri', () => {
  const boardMember = makeActor({
    id: 'yk',
    permissions: [
      'CONTENT_READ_ALL', 'CONTENT_WRITE_ALL',
      'BUDGET_READ_ALL', 'BUDGET_WRITE_ALL',
      'INVITE_MANAGE', 'CHANNEL_CREATE', 'CHANNEL_MANAGE_ALL',
    ],
  })
  const readOnlyBoard = makeActor({ id: 'denetim', permissions: ['CONTENT_READ_ALL'] })

  it('CONTENT_READ_ALL, üye olmadığı PRIVATE kanalın içeriğini açar', () => {
    expect(can(boardMember, 'content:read', privateContent)).toBe(true)
    expect(can(outsider, 'content:read', privateContent)).toBe(false)
  })

  it('CONTENT_READ_ALL tek başına yazma vermez', () => {
    expect(can(readOnlyBoard, 'content:write', privateContent)).toBe(false)
    expect(can(boardMember, 'content:write', privateContent)).toBe(true)
  })

  it('CONTENT_READ_ALL, PRIVATE kanalın kendisini de görünür kılar', () => {
    expect(can(readOnlyBoard, 'channel:read', privateChannel)).toBe(true)
  })

  it('BUDGET_READ_ALL, LEAD olmadan bütçeyi açar', () => {
    const budget: Resource = {
      kind: 'budget', channelId: 'c1', channelVisibility: 'PRIVATE', channelArchivedAt: null,
    }
    expect(can(readOnlyBoard, 'budget:read', budget)).toBe(false)
    expect(can(boardMember, 'budget:read', budget)).toBe(true)
    expect(can(lead, 'budget:read', budget)).toBe(true)
    expect(can(member, 'budget:read', budget)).toBe(false)
  })

  it('BUDGET_WRITE_ALL olmadan bütçe yazılamaz, arşivli kanalda hiç yazılamaz', () => {
    const budget: Resource = {
      kind: 'budget', channelId: 'c1', channelVisibility: 'PRIVATE', channelArchivedAt: null,
    }
    const archived: Resource = { ...budget, channelArchivedAt: new Date() }
    expect(can(boardMember, 'budget:write', budget)).toBe(true)
    expect(can(readOnlyBoard, 'budget:write', budget)).toBe(false)
    expect(can(lead, 'budget:write', budget)).toBe(false)
    expect(can(boardMember, 'budget:write', archived)).toBe(false)
  })

  it('INVITE_MANAGE daveti açar, taşımayan role kapalıdır', () => {
    expect(can(boardMember, 'invite:create', { kind: 'invite' })).toBe(true)
    expect(can(readOnlyBoard, 'invite:create', { kind: 'invite' })).toBe(false)
  })

  it('CHANNEL_MANAGE_ALL, üye olmadığı kanalın ayarlarını açar', () => {
    expect(can(boardMember, 'channel:manageMembers', privateChannel)).toBe(true)
    expect(can(readOnlyBoard, 'channel:manageMembers', privateChannel)).toBe(false)
  })

  it('CONTENT_WRITE_ALL, üye olmadığı kanalın dokümanını düzenletir', () => {
    const channelDoc: Resource = {
      kind: 'document', channelId: 'c1', channelVisibility: 'PRIVATE', channelArchivedAt: null,
      documentVisibility: 'CHANNEL', ownerId: 'member',
    }
    expect(can(boardMember, 'document:write', channelDoc)).toBe(true)
    expect(can(readOnlyBoard, 'document:write', channelDoc)).toBe(false)
    expect(can(readOnlyBoard, 'document:read', channelDoc)).toBe(true)
  })

  it('pasif aktör izin taşısa da hiçbir şey yapamaz', () => {
    const passive = makeActor({ ...boardMember, isActive: false })
    expect(can(passive, 'content:read', privateContent)).toBe(false)
    expect(can(passive, 'budget:read', {
      kind: 'budget', channelId: 'c1', channelVisibility: 'PRIVATE', channelArchivedAt: null,
    })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/policy.test.ts`
Expected: FAIL — "CONTENT_READ_ALL, üye olmadığı PRIVATE kanalın içeriğini açar" ve devamı, çünkü `can()` hâlâ yalnızca `isAdmin` bakıyor.

- [ ] **Step 3: `can()` dallarını izne çevir**

`src/lib/auth/policy.ts` içinde aşağıdaki case'leri değiştir. **Değişmeyen tek şey:** dosyanın en üstündeki `if (!actor.isActive) return false` kapısı.

```ts
    case 'channel:create':
      return resource.kind === 'channel:new' &&
        (has(actor, 'CHANNEL_CREATE') ||
          actor.memberships.some((m) => m.channelRole === 'LEAD'))

    case 'channel:read':
      if (resource.kind !== 'channel') return false
      return resource.visibility === 'OPEN' ||
        has(actor, 'CONTENT_READ_ALL') ||
        !!membership(actor, resource.id)

    case 'channel:update':
    case 'channel:manageMembers': {
      if (resource.kind !== 'channel' || resource.archivedAt) return false
      return has(actor, 'CHANNEL_MANAGE_ALL') ||
        membership(actor, resource.id)?.channelRole === 'LEAD'
    }

    case 'channel:archive':
      return resource.kind === 'channel' && has(actor, 'CHANNEL_MANAGE_ALL')

    case 'content:read': {
      if (resource.kind !== 'content') return false
      return resource.channelVisibility === 'OPEN' ||
        has(actor, 'CONTENT_READ_ALL') ||
        !!membership(actor, resource.channelId)
    }

    case 'content:write': {
      if (resource.kind !== 'content') return false
      // Arşivlenmiş kanal salt-okunur: içeriği de kapsar.
      if (resource.channelArchivedAt) return false
      if (has(actor, 'CONTENT_WRITE_ALL')) return true
      if (membership(actor, resource.channelId)) return true
      // Atama, PRIVATE kanalda üyeliğin yerine geçmez. Geçseydi kişi
      // yazabildiği içeriği okuyamazdı.
      if (resource.channelVisibility !== 'OPEN') return false
      return resource.assigneeIds?.includes(actor.id) ?? false
    }

    case 'content:delete': {
      if (resource.kind !== 'content') return false
      if (resource.channelArchivedAt) return false
      if (has(actor, 'CONTENT_WRITE_ALL')) return true
      if (resource.ownerId === actor.id) return true
      return membership(actor, resource.channelId)?.channelRole === 'LEAD'
    }

    case 'invite:create':
    case 'invite:revoke':
    case 'invite:list':
      return resource.kind === 'invite' && has(actor, 'INVITE_MANAGE')

    case 'document:create':
      if (resource.kind !== 'document:new') return false
      if (resource.channelVisibility === 'PRIVATE' && !has(actor, 'CONTENT_WRITE_ALL')) {
        return !!membership(actor, resource.channelId)
      }
      return has(actor, 'CONTENT_WRITE_ALL') || !!membership(actor, resource.channelId)

    case 'document:read': {
      if (resource.kind !== 'document') return false
      if (resource.channelArchivedAt) return false
      if (has(actor, 'CONTENT_READ_ALL')) return true
      if (resource.documentVisibility === 'PUBLIC') return true
      if (resource.documentVisibility === 'CHANNEL') {
        return !!membership(actor, resource.channelId)
      }
      // PRIVATE: sahip + paylaşılan
      return resource.ownerId === actor.id || !!resource.shared
    }

    case 'document:write': {
      if (resource.kind !== 'document') return false
      if (resource.channelArchivedAt) return false
      if (has(actor, 'CONTENT_WRITE_ALL')) return true
      if (resource.ownerId === actor.id) return true
      if (!!resource.sharedEdit) return true
      // CHANNEL/OPEN üyeler kanal içinde yazar; PRIVATE dokümanda kanal üyeliği
      // yazma vermez (paylaşılan değilse görünmüyor zaten).
      if (resource.documentVisibility === 'PRIVATE') return false
      return !!membership(actor, resource.channelId)
    }

    case 'document:share':
    case 'document:delete':
      if (resource.kind !== 'document') return false
      if (has(actor, 'CONTENT_WRITE_ALL')) return true
      if (resource.ownerId === actor.id) return true
      return membership(actor, resource.channelId)?.channelRole === 'LEAD'

    // Para kalemleri içerikten daha kapalı: kanal üyeliği yetmez.
    case 'budget:read':
      if (resource.kind !== 'budget') return false
      if (has(actor, 'BUDGET_READ_ALL')) return true
      return membership(actor, resource.channelId)?.channelRole === 'LEAD'

    case 'budget:write':
      // LEAD bütçeyi görür, değiştiremez — kulübün parasal kaydını dar
      // tutmak bilinçli bir karar.
      if (resource.kind !== 'budget') return false
      if (resource.channelArchivedAt) return false
      return has(actor, 'BUDGET_WRITE_ALL')
```

`member:*` case'leri bu task'ta **değişmez** — Task 4'ün konusu.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/policy.test.ts tests/unit/budget-policy.test.ts tests/unit/doc-policy.test.ts`
Expected: PASS. Eski testler de geçmeli — `has()` ADMIN için `true` döndüğü için mevcut admin davranışı birebir korunur.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/policy.ts tests/unit/policy.test.ts
git commit -m "feat: resolve can() decisions through role permissions"
```

---

### Task 4: SUPERADMIN kademesi ve iki mevcut defekt

**Files:**
- Modify: `src/lib/auth/policy.ts` (`Action` birliğine `role:manage`, `Resource` birliğine `{ kind: 'role' }` ve `member` kaydına `targetGlobalRole`, `member:*` case'leri)
- Modify: `src/server/members.ts:41-52` (havuz koruması), `:74-130` (authorize blokları, `updateMemberRole` şeması)
- Modify: `src/app/(app)/members/page.tsx:16`
- Modify: `tests/unit/policy.test.ts` (`member:*` blokları)
- Modify: `tests/integration/members.test.ts`

**Interfaces:**
- Consumes: `has()`, `GlobalRole` (Task 2).
- Produces:
  - `Action` birliği `'role:manage'` kazanır.
  - `Resource` birliği `{ kind: 'role' }` kazanır; `{ kind: 'member' }` artık `targetGlobalRole: GlobalRole` **zorunlu** alanını taşır.
  - `updateMemberRole` girdisi: `{ userId: string; globalRole: 'SUPERADMIN' | 'ADMIN' | 'MEMBER' }`

- [ ] **Step 1: Write the failing test (birim)**

`tests/unit/policy.test.ts` içindeki "davet ve üye yönetimi" bloğunu şu hale getir:

```ts
describe('can() — davet ve üye yönetimi', () => {
  const superadmin = makeActor({ id: 'superadmin', globalRole: 'SUPERADMIN' })
  const hr = makeActor({ id: 'ik', permissions: ['MEMBER_MANAGE', 'INVITE_MANAGE'] })
  const targetMember = { kind: 'member', id: 'other', targetGlobalRole: 'MEMBER' } as const
  const targetAdmin = { kind: 'member', id: 'baskan', targetGlobalRole: 'ADMIN' } as const
  const targetSuperadmin = { kind: 'member', id: 'sahip', targetGlobalRole: 'SUPERADMIN' } as const

  it('daveti INVITE_MANAGE taşıyan üretir ve iptal eder', () => {
    expect(can(admin, 'invite:create', { kind: 'invite' })).toBe(true)
    expect(can(hr, 'invite:create', { kind: 'invite' })).toBe(true)
    expect(can(lead, 'invite:create', { kind: 'invite' })).toBe(false)
    expect(can(hr, 'invite:revoke', { kind: 'invite' })).toBe(true)
    expect(can(lead, 'invite:revoke', { kind: 'invite' })).toBe(false)
  })

  it('bekleyen davet kodlarını INVITE_MANAGE taşıyan listeler', () => {
    expect(can(hr, 'invite:list', { kind: 'invite' })).toBe(true)
    expect(can(lead, 'invite:list', { kind: 'invite' })).toBe(false)
  })

  it('üye listesini herkes görür', () => {
    expect(can(member, 'member:list', targetMember)).toBe(true)
  })

  // Kimin ADMIN olacağına yalnızca SUPERADMIN karar verir: İK'ya üye pasife
  // alma yetkisi vermek, ona Başkan üretme yetkisi vermek anlamına gelmemeli.
  it('global rolü yalnızca SUPERADMIN değiştirir', () => {
    expect(can(superadmin, 'member:updateRole', targetMember)).toBe(true)
    expect(can(admin, 'member:updateRole', targetMember)).toBe(false)
    expect(can(hr, 'member:updateRole', targetMember)).toBe(false)
    expect(can(member, 'member:updateRole', targetMember)).toBe(false)
  })

  it('kimse kendini pasife alamaz', () => {
    expect(can(admin, 'member:deactivate', targetMember)).toBe(true)
    expect(can(admin, 'member:deactivate', {
      kind: 'member', id: 'admin', targetGlobalRole: 'ADMIN',
    })).toBe(false)
    expect(can(superadmin, 'member:deactivate', {
      kind: 'member', id: 'superadmin', targetGlobalRole: 'SUPERADMIN',
    })).toBe(false)
  })

  // Defekt: hedefin rolü bilinmediği için Başkan, sistem sahibini
  // pasife alabiliyordu.
  it('ADMIN, SUPERADMIN’i pasife alamaz ve geri açamaz', () => {
    expect(can(admin, 'member:deactivate', targetSuperadmin)).toBe(false)
    expect(can(admin, 'member:reactivate', targetSuperadmin)).toBe(false)
    expect(can(superadmin, 'member:deactivate', targetSuperadmin)).toBe(true)
  })

  it('MEMBER_MANAGE yalnızca düz üyeye uygulanır', () => {
    expect(can(hr, 'member:deactivate', targetMember)).toBe(true)
    expect(can(hr, 'member:deactivate', targetAdmin)).toBe(false)
    expect(can(hr, 'member:deactivate', targetSuperadmin)).toBe(false)
    expect(can(hr, 'member:reactivate', targetMember)).toBe(true)
    expect(can(hr, 'member:reactivate', targetAdmin)).toBe(false)
  })

  it('izinsiz kimse üye durumunu değiştiremez', () => {
    expect(can(member, 'member:deactivate', targetMember)).toBe(false)
    expect(can(lead, 'member:deactivate', targetMember)).toBe(false)
    expect(can(member, 'member:reactivate', targetMember)).toBe(false)
  })
})

describe('can() — rol yönetimi', () => {
  const superadmin = makeActor({ id: 'superadmin', globalRole: 'SUPERADMIN' })
  const everyPermission = makeActor({
    id: 'yk',
    permissions: [
      'CONTENT_READ_ALL', 'CONTENT_WRITE_ALL', 'BUDGET_READ_ALL', 'BUDGET_WRITE_ALL',
      'MEMBER_MANAGE', 'INVITE_MANAGE', 'CHANNEL_CREATE', 'CHANNEL_MANAGE_ALL', 'TRASH_MANAGE',
    ],
  })

  // İzinleri dağıtan yetkinin kendisi ayarlanabilir bir izin olsaydı, onu
  // taşıyan herkes kendine her şeyi yazabilirdi.
  it('rolleri yalnızca SUPERADMIN yönetir', () => {
    expect(can(superadmin, 'role:manage', { kind: 'role' })).toBe(true)
    expect(can(admin, 'role:manage', { kind: 'role' })).toBe(false)
    expect(can(everyPermission, 'role:manage', { kind: 'role' })).toBe(false)
    expect(can(member, 'role:manage', { kind: 'role' })).toBe(false)
  })

  it('pasif SUPERADMIN rol yönetemez', () => {
    expect(can(makeActor({ id: 's', globalRole: 'SUPERADMIN', isActive: false }),
      'role:manage', { kind: 'role' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/policy.test.ts`
Expected: FAIL — `role:manage` `Action` birliğinde yok, `targetGlobalRole` `Resource` üzerinde yok.

- [ ] **Step 3: `policy.ts`'i güncelle**

`Action` birliğine ekle:

```ts
  | 'role:manage'
```

`Resource` birliğinde `member` kaydını değiştir ve `role` ekle:

```ts
  // targetGlobalRole ZORUNLU: hedefin kademesi bilinmeden "ADMIN,
  // SUPERADMIN'e dokunamaz" kuralı yazılamaz. Opsiyonel olsaydı çağıranın
  // unutması sessizce yetki açardı.
  | { kind: 'member'; id: string; targetGlobalRole: GlobalRole }
  | { kind: 'role' }
```

`member:*` case'lerini değiştir:

```ts
    case 'member:list':
      return resource.kind === 'member'

    case 'member:updateRole':
      // Kimin ADMIN olacağı hiçbir izne bağlanmaz.
      return resource.kind === 'member' && actor.globalRole === 'SUPERADMIN'

    case 'member:deactivate': {
      if (resource.kind !== 'member') return false
      // Kimse kendini pasife alamaz: sistemde yetkili kalmama riski.
      if (resource.id === actor.id) return false
      if (actor.globalRole === 'SUPERADMIN') return true
      // Sistem sahibine yalnızca sistem sahibi dokunur.
      if (resource.targetGlobalRole === 'SUPERADMIN') return false
      if (actor.globalRole === 'ADMIN') return true
      return has(actor, 'MEMBER_MANAGE') && resource.targetGlobalRole === 'MEMBER'
    }

    case 'member:reactivate': {
      // Havuzu yalnızca büyütür — kendi kendini etkinleştirme senaryosu
      // pasif aktörün hiçbir yetkisi olmaması yüzünden zaten erişilemez.
      if (resource.kind !== 'member') return false
      if (actor.globalRole === 'SUPERADMIN') return true
      if (resource.targetGlobalRole === 'SUPERADMIN') return false
      if (actor.globalRole === 'ADMIN') return true
      return has(actor, 'MEMBER_MANAGE') && resource.targetGlobalRole === 'MEMBER'
    }

    case 'role:manage':
      return resource.kind === 'role' && actor.globalRole === 'SUPERADMIN'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test (entegrasyon)**

`tests/integration/members.test.ts` içindeki `beforeEach`'i (satır 25-29) ve testleri genişlet:

```ts
let superadmin: { id: string }
let admin: { id: string }
let target: { id: string }

beforeEach(async () => {
  await resetDb()
  superadmin = await db.user.create({ data: { name: 'Sahip', globalRole: 'SUPERADMIN' } })
  admin = await db.user.create({ data: { name: 'Başkan', globalRole: 'ADMIN' } })
  target = await db.user.create({ data: { name: 'Ayrılan' } })
})
```

Mevcut testlerdeki `admin` kullanımları olduğu gibi çalışır. Dosyanın sonuna ekle:

```ts
describe('SUPERADMIN koruması', () => {
  it('ADMIN, SUPERADMIN’i pasife alamaz', async () => {
    actorRef.current = admin.id
    const r = await deactivateMember({ userId: superadmin.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('son aktif SUPERADMIN pasife alınamaz', async () => {
    const other = await db.user.create({ data: { name: 'İkinci', globalRole: 'SUPERADMIN' } })
    actorRef.current = superadmin.id

    const first = await deactivateMember({ userId: other.id })
    expect(first.ok).toBe(true)

    // Artık tek aktif SUPERADMIN kaldı; onu da düşürmek sistemi sahipsiz bırakır.
    actorRef.current = other.id
    const second = await deactivateMember({ userId: superadmin.id })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('CONFLICT')
  })

  it('bir SUPERADMIN diğerini düşürebilir — devir teslim böyle yapılır', async () => {
    const eskiBaskan = await db.user.create({
      data: { name: 'Eski Başkan', globalRole: 'SUPERADMIN' },
    })
    actorRef.current = superadmin.id

    const r = await updateMemberRole({ userId: eskiBaskan.id, globalRole: 'MEMBER' })

    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: eskiBaskan.id } })
    expect(updated.globalRole).toBe('MEMBER')
  })

  it('ADMIN global rol değiştiremez', async () => {
    actorRef.current = admin.id
    const r = await updateMemberRole({ userId: target.id, globalRole: 'ADMIN' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('MEMBER_MANAGE taşıyan rol düz üyeyi pasife alır, Başkan’a dokunamaz', async () => {
    const role = await db.role.create({
      data: { name: 'İnsan Kaynakları', slug: 'insan-kaynaklari', position: 1,
              permissions: ['MEMBER_MANAGE'] },
    })
    const hr = await db.user.create({ data: { name: 'İK' } })
    await db.userRole.create({ data: { userId: hr.id, roleId: role.id } })
    actorRef.current = hr.id

    expect((await deactivateMember({ userId: target.id })).ok).toBe(true)

    const blocked = await deactivateMember({ userId: admin.id })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error.code).toBe('FORBIDDEN')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/members.test.ts`
Expected: FAIL — `deactivateMember`'ın `authorize`'ı hedefin rolünü okumuyor; havuz koruması hâlâ ADMIN'i sayıyor.

- [ ] **Step 7: `members.ts`'i güncelle**

`src/server/members.ts` satır 41-52'yi değiştir (fonksiyon adı dahil):

```ts
// Korunan havuz ADMIN değil SUPERADMIN'dir. Üç değerli enum'da bu ayrım
// zorunlu: ADMIN havuzunun boşalması geri alınabilir (SUPERADMIN yeniden
// atar), SUPERADMIN havuzunun boşalması sistemi rol yönetimi yapılamaz
// halde bırakır.
async function assertActiveSuperadminSurvivesWithout(
  tx: Prisma.TransactionClient,
  target: MemberRow,
): Promise<void> {
  if (target.globalRole !== 'SUPERADMIN' || !target.isActive) return
  const remaining = await tx.user.count({
    where: { globalRole: 'SUPERADMIN', isActive: true, id: { not: target.id } },
  })
  if (remaining === 0) {
    throw actionError('CONFLICT', { globalRole: 'Sistemde en az bir aktif superadmin kalmalı.' })
  }
}
```

`assertActiveAdminSurvivesWithout` çağrılarının hepsini (`deactivateMember` ve `updateMemberRole` handler'larında) yeni ada çevir. `runAdminGuardedChange` sarmalayıcısı aynen kalır.

`updateMemberRole`'un girdi şemasını genişlet:

```ts
  input: z.object({
    userId: z.string().cuid(),
    globalRole: z.enum(['SUPERADMIN', 'ADMIN', 'MEMBER']),
  }),
```

Üç action'ın `authorize` bloğunu hedefin rolünü okuyacak şekilde değiştir (`deactivateMember`, `reactivateMember`, `updateMemberRole` — hepsinde aynı desen):

```ts
  authorize: async ({ actor, input }) => {
    // Hedefin kademesi bilinmeden karar verilemez: "ADMIN, SUPERADMIN'e
    // dokunamaz" kuralı buna dayanıyor.
    const target = await db.user.findUnique({
      where: { id: input.userId },
      select: { globalRole: true },
    })
    if (!target) return { allowed: false, code: 'NOT_FOUND' }
    return {
      allowed: can(actor, 'member:deactivate', {
        kind: 'member', id: input.userId, targetGlobalRole: target.globalRole,
      }),
    }
  },
```

`reactivateMember` için action adı `'member:reactivate'`, `updateMemberRole` için `'member:updateRole'` olur.

- [ ] **Step 8: `members/page.tsx`'in `can()` çağrısını düzelt**

`src/app/(app)/members/page.tsx:16`:

```ts
  if (!can(actor, 'member:list', {
    kind: 'member', id: actor.id, targetGlobalRole: actor.globalRole,
  })) notFound()
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
pnpm typecheck && pnpm vitest run tests/unit/policy.test.ts tests/integration/members.test.ts
```
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/auth/policy.ts src/server/members.ts "src/app/(app)/members/page.tsx" tests/
git commit -m "fix: keep the superadmin pool protected and out of admin reach"
```

---

### Task 5: Liste sorgularının kapsamını izne bağla

**Files:**
- Modify: `src/server/channels-query.ts:21-30`, `tasks-query.ts:49`, `events-query.ts:36`, `sponsors-query.ts:54`, `documents-query.ts:139`, `budget-query.ts:74-77`
- Modify: `src/app/(app)/members/page.tsx:18,27,62,81,82,99,100`
- Test: `tests/integration/roles-visibility.test.ts`

**Interfaces:**
- Consumes: `has()` (Task 2).
- Produces: `budgetChannelIds(actor)` davranışı değişir — `BUDGET_READ_ALL` taşıyan `'all'` alır.

> `can()` tekil kaynak için karar verir; **liste sorguları ayrı bir yüzeydir**. Bu task atlanırsa YK üyesi bir görevi doğrudan URL'siyle açabilir ama listede göremez.

- [ ] **Step 1: Write the failing test**

`tests/integration/roles-visibility.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

const actorRef: { current: string | null } = { current: null }
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () => {
    if (!actorRef.current) return null
    const user = await db.user.findUniqueOrThrow({
      where: { id: actorRef.current },
      include: {
        memberships: true,
        roles: { select: { role: { select: { permissions: true } } } },
      },
    })
    return {
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
      permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions))],
    }
  },
}))

const { listVisibleChannels } = await import('@/server/channels-query')
const { budgetChannelIds } = await import('@/server/budget-query')
const { getActor } = await import('@/lib/auth/session')

let boardMember: { id: string }
let plainMember: { id: string }
let boardChannelId: string

beforeEach(async () => {
  await resetDb()
  const owner = await db.user.create({ data: { name: 'Sahip', globalRole: 'SUPERADMIN' } })
  const role = await db.role.create({
    data: {
      name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1, isSystem: true,
      permissions: ['CONTENT_READ_ALL', 'CONTENT_WRITE_ALL', 'BUDGET_READ_ALL'],
    },
  })
  boardMember = await db.user.create({ data: { name: 'YK Üyesi' } })
  await db.userRole.create({ data: { userId: boardMember.id, roleId: role.id } })
  plainMember = await db.user.create({ data: { name: 'Düz Üye' } })

  const channel = await db.channel.create({
    data: {
      name: 'Yönetim Kurulu', slug: 'yonetim-kurulu-kanali',
      visibility: 'PRIVATE', createdById: owner.id,
    },
  })
  boardChannelId = channel.id
})

describe('yönetime özel kanal', () => {
  it('YK rolü olan kanalı üye olmadan görür', async () => {
    actorRef.current = boardMember.id
    const channels = await listVisibleChannels()
    expect(channels.map((c) => c.id)).toContain(boardChannelId)
  })

  it('düz üye kanalı hiç görmez', async () => {
    actorRef.current = plainMember.id
    const channels = await listVisibleChannels()
    expect(channels).toEqual([])
  })
})

describe('bütçe kapsamı', () => {
  it('BUDGET_READ_ALL taşıyan tüm bütçeyi görür', async () => {
    actorRef.current = boardMember.id
    const actor = await getActor()
    expect(actor && budgetChannelIds(actor)).toBe('all')
  })

  it('izinsiz üye hiçbir kanalın bütçesini görmez', async () => {
    actorRef.current = plainMember.id
    const actor = await getActor()
    expect(actor && budgetChannelIds(actor)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/roles-visibility.test.ts`
Expected: FAIL — "YK rolü olan kanalı üye olmadan görür" (`channels` boş) ve "BUDGET_READ_ALL taşıyan tüm bütçeyi görür" (`[]` döner).

- [ ] **Step 3: Sorgu dosyalarını güncelle**

`src/server/channels-query.ts` satır 13-31:

```ts
import { db } from '@/lib/db'
import { getActor } from '@/lib/auth/session'
import { has } from '@/lib/auth/policy'
import type { Channel } from '@prisma/client'

export async function listVisibleChannels(): Promise<Channel[]> {
  const actor = await getActor()
  if (!actor) return []

  const memberChannelIds = actor.memberships.map((m) => m.channelId)
  return db.channel.findMany({
    where: {
      archivedAt: null,
      ...(has(actor, 'CONTENT_READ_ALL')
        ? {}
        : { OR: [{ visibility: 'OPEN' }, { id: { in: memberChannelIds } }] }),
    },
    orderBy: { name: 'asc' },
  })
}
```

`src/server/tasks-query.ts:49`, `events-query.ts:36`, `sponsors-query.ts:54`, `documents-query.ts:139` — her birinde `actor.globalRole === 'ADMIN'` kontrolünü değiştir ve `has` import'unu ekle:

```ts
import { has } from '@/lib/auth/policy'
// ...
  if (has(actor, 'CONTENT_READ_ALL')) return {}
```

(`documents-query.ts:139` içinde değişken adı `resolved`: `if (has(resolved, 'CONTENT_READ_ALL')) {`)

`src/server/budget-query.ts:74-77`:

```ts
/**
 * Bütçeyi görebildiği kanallar: BUDGET_READ_ALL taşıyan hepsini, diğerleri
 * yalnızca LEAD olduklarını. `can(actor, 'budget:read', …)` dallarının sorgu
 * karşılığı — kanal üyeliği (MEMBER) yetmez.
 */
export function budgetChannelIds(actor: Actor): string[] | 'all' {
  if (has(actor, 'BUDGET_READ_ALL')) return 'all'
  return actor.memberships.filter((m) => m.channelRole === 'LEAD').map((m) => m.channelId)
}
```

- [ ] **Step 4: `members/page.tsx`'teki tek `isAdmin` bayrağını ikiye ayır**

`src/app/(app)/members/page.tsx:18` iki ayrı soruyu tek bayrakla cevaplıyordu; ayrılmazsa `CONTENT_READ_ALL` taşıyan biri pasif üyeleri de görürdü.

Satır 18'i değiştir:

```ts
  // Pasif üyeleri görmek ve üye işlemleri yapmak üye yönetimi yetkisidir;
  // PRIVATE kanal adlarını görmek içerik okuma yetkisidir. Ayrı sorular.
  const canManageMembers = has(actor, 'MEMBER_MANAGE')
  const canSeeAllChannels = has(actor, 'CONTENT_READ_ALL')
```

Import satırına `has` ekle:

```ts
import { can, has } from '@/lib/auth/policy'
```

Satır 27: `where: canManageMembers ? {} : { isActive: true },`
Satır 62: `.filter(({ channel }) => channel.visibility === 'OPEN' || canSeeAllChannels || viewerChannelIds.has(channel.id))`
Satır 81, 82, 99, 100: `isAdmin` → `canManageMembers`

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm typecheck && pnpm vitest run tests/integration/roles-visibility.test.ts
```
Expected: PASS — 4 test.

- [ ] **Step 6: Bütün takımı koştur**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server "src/app/(app)/members/page.tsx" tests/integration/roles-visibility.test.ts
git commit -m "feat: scope list queries by role permissions"
```

---

### Task 6: Çöp kutusu, yorum moderasyonu ve UI bayrakları

**Files:**
- Modify: `src/app/(app)/trash/page.tsx:15`, `src/server/documents-query.ts:187`
- Modify: `src/server/documents.ts:111,130`, `src/server/tasks.ts:338`, `src/server/events.ts:153`, `src/server/sponsors.ts:201`
- Modify: `src/server/comments.ts:102`
- Modify: `src/components/comments/comment-thread.tsx:20-26,143`
- Modify: `src/app/(app)/docs/[id]/page.tsx:102`, `src/app/(app)/sponsors/[id]/page.tsx:59`, `src/app/(app)/events/[id]/page.tsx:186`
- Modify: `src/components/layout/sidebar.tsx:33`, `src/components/layout/sidebar-nav.tsx:40,185,304`
- Test: `tests/integration/comments.test.ts` (yeni vaka)

**Interfaces:**
- Consumes: `has()` (Task 2).
- Produces: `CommentThread` prop'u `isAdmin` yerine `canModerate: boolean`; `SidebarNav` prop'u `isAdmin` yerine `canSeeAdminPanel: boolean`.

- [ ] **Step 1: Write the failing test**

`tests/integration/comments.test.ts` sonuna ekle. Dosyanın mevcut fixture'larını kullanıyor: `member` (kanal LEAD'i), `other` (kanal üyesi), `outsider` (kanal dışı), `publicDoc`. Eylem adları `addComment` / `deleteComment`, `deleteComment` girdisi `{ id }`, `actorRef.current` bir **nesne** (`{ id: ... }`).

```ts
describe('yorum moderasyonu', () => {
  it('CONTENT_WRITE_ALL taşıyan başkasının yorumunu silebilir', async () => {
    const role = await db.role.create({
      data: {
        name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1,
        permissions: ['CONTENT_READ_ALL', 'CONTENT_WRITE_ALL'],
      },
    })
    const moderator = await db.user.create({ data: { name: 'YK Üyesi' } })
    await db.userRole.create({ data: { userId: moderator.id, roleId: role.id } })

    actorRef.current = { id: other.id }
    const created = await addComment({
      entityType: 'Document', entityId: publicDoc.id, body: 'silinecek',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    // Moderatör kanala üye DEĞİL; yetkisi yalnızca rolünden geliyor.
    actorRef.current = { id: moderator.id }
    const removed = await deleteComment({ id: created.data.id })

    expect(removed.ok).toBe(true)
  })

  it('izinsiz üye başkasının yorumunu silemez', async () => {
    actorRef.current = { id: other.id }
    const created = await addComment({
      entityType: 'Document', entityId: publicDoc.id, body: 'kalacak',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    actorRef.current = { id: outsider.id }
    const removed = await deleteComment({ id: created.data.id })

    expect(removed.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/comments.test.ts`
Expected: FAIL — "CONTENT_WRITE_ALL taşıyan başkasının yorumunu silebilir"; `comments.ts:102` yalnızca `globalRole === 'ADMIN'` bakıyor.

- [ ] **Step 3: Sunucu tarafını güncelle**

`src/server/comments.ts:102`:

```ts
    return { allowed: comment.authorId === actor.id || has(actor, 'CONTENT_WRITE_ALL') }
```

`src/app/(app)/trash/page.tsx:15`:

```ts
  if (!has(actor, 'TRASH_MANAGE')) notFound()
```

`src/server/documents-query.ts:187`:

```ts
  if (!actor || !has(actor, 'TRASH_MANAGE')) return []
```

`src/server/documents.ts:111` ve `:130`, `src/server/tasks.ts:338`, `src/server/events.ts:153`, `src/server/sponsors.ts:201` — beşinde de:

```ts
  authorize: async ({ actor }) => ({ allowed: has(actor, 'TRASH_MANAGE') }),
```

Her dosyaya `import { has } from '@/lib/auth/policy'` ekle (zaten `can` import edenlerde aynı satıra ekle).

- [ ] **Step 4: UI bayraklarını anlamlarına göre adlandır**

`src/components/comments/comment-thread.tsx` — satır 20 ve 26'daki `isAdmin` prop'unu `canModerate` yap, satır 143'teki `(mine || isAdmin)` ifadesini `(mine || canModerate)` yap.

Çağıran üç sayfa:

```tsx
// src/app/(app)/docs/[id]/page.tsx:102
// src/app/(app)/sponsors/[id]/page.tsx:59
// src/app/(app)/events/[id]/page.tsx:186
        canModerate={has(actor, 'CONTENT_WRITE_ALL')}
```

`src/components/layout/sidebar.tsx:33`:

```tsx
      canSeeAdminPanel={has(actor, 'INVITE_MANAGE')}
```

`src/components/layout/sidebar-nav.tsx` — satır 40 ve 185'teki `isAdmin` prop adını `canSeeAdminPanel` yap, satır 304'teki `{isAdmin && (` ifadesini `{canSeeAdminPanel && (` yap.

> Yönetim sayfasının kendi kapısı `invite:list` (`admin/page.tsx:31`). Sidebar bağlantısını aynı izne bağlamak, görünen bağlantının 404'e gitmemesini garanti eder.

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm typecheck && pnpm lint && pnpm test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src tests/integration/comments.test.ts
git commit -m "feat: gate trash and comment moderation on permissions"
```

---

### Task 7: İzin etiketleri ve rol sorguları

**Files:**
- Create: `src/lib/permission-labels.ts`
- Create: `src/server/roles-query.ts`
- Test: `tests/unit/permission-labels.test.ts`

**Interfaces:**
- Consumes: `Permission` (Task 2).
- Produces:
  - `permissionOrder: Permission[]`, `permissionGroupOrder: PermissionGroup[]`, `permissionGroupLabels: Record<PermissionGroup, string>`, `permissionLabels: Record<Permission, { group: PermissionGroup; label: string }>`
  - `type RoleSummary = { id: string; name: string; slug: string; color: string | null; permissions: Permission[]; isSystem: boolean; position: number; memberCount: number }`
  - `type RoleDetail = RoleSummary & { members: { id: string; name: string }[] }`
  - `listRoles(): Promise<RoleSummary[]>`, `loadRole(id: string): Promise<RoleDetail | null>`

- [ ] **Step 1: Write the failing test**

`tests/unit/permission-labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { permissionLabels, permissionOrder } from '@/lib/permission-labels'

describe('izin etiketleri', () => {
  it('her izin için Türkçe etiket ve grup vardır', () => {
    for (const permission of permissionOrder) {
      const entry = permissionLabels[permission]
      expect(entry.label.length).toBeGreaterThan(0)
      // Ham enum adı arayüze sızmamalı.
      expect(entry.label).not.toMatch(/[A-Z]{2,}_/)
    }
  })

  it('sıralama listesi kataloğun tamamını kapsar, tekrar içermez', () => {
    const catalogue = Object.keys(permissionLabels).sort()
    expect([...permissionOrder].sort()).toEqual(catalogue)
    expect(new Set(permissionOrder).size).toBe(permissionOrder.length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/permission-labels.test.ts`
Expected: FAIL — `@/lib/permission-labels` yok.

- [ ] **Step 3: `permission-labels.ts`'i yaz**

```ts
import type { Permission } from '@/lib/auth/policy'

/**
 * `activity-labels.ts:16-27` ile aynı kural: SAKLANAN değer İngilizce ve
 * makine okunur kalır, GÖSTERİLEN değer bu sözlükten geçer. `Record<Permission, …>`
 * olduğu için kataloğa yeni izin eklenip buraya karşılığı yazılmazsa
 * `tsc --noEmit` hata verir — sessizce ham enum adı sızamaz.
 */
export type PermissionGroup = 'content' | 'money' | 'management'

export const permissionGroupOrder: PermissionGroup[] = ['content', 'money', 'management']

export const permissionGroupLabels: Record<PermissionGroup, string> = {
  content: 'İçerik',
  money: 'Para',
  management: 'Yönetim',
}

export const permissionLabels: Record<Permission, { group: PermissionGroup; label: string }> = {
  CONTENT_READ_ALL: {
    group: 'content', label: 'Tüm koordinatörlüklerin içeriğini görür',
  },
  CONTENT_WRITE_ALL: {
    group: 'content', label: 'Tüm koordinatörlüklerde düzenleme ve silme yapar',
  },
  BUDGET_READ_ALL: {
    group: 'money', label: 'Tüm bütçeyi görür',
  },
  BUDGET_WRITE_ALL: {
    group: 'money', label: 'Bütçe kalemi ekler ve düzenler',
  },
  MEMBER_MANAGE: {
    group: 'management', label: 'Üyeyi pasife alır ve geri açar',
  },
  INVITE_MANAGE: {
    group: 'management', label: 'Davet üretir ve iptal eder',
  },
  CHANNEL_CREATE: {
    group: 'management', label: 'Yeni koordinatörlük açar',
  },
  CHANNEL_MANAGE_ALL: {
    group: 'management', label: 'Her koordinatörlüğün ayarını ve üyelerini yönetir',
  },
  TRASH_MANAGE: {
    group: 'management', label: 'Çöp kutusunu görür ve kalıcı siler',
  },
}

export const permissionOrder: Permission[] = [
  'CONTENT_READ_ALL',
  'CONTENT_WRITE_ALL',
  'BUDGET_READ_ALL',
  'BUDGET_WRITE_ALL',
  'MEMBER_MANAGE',
  'INVITE_MANAGE',
  'CHANNEL_CREATE',
  'CHANNEL_MANAGE_ALL',
  'TRASH_MANAGE',
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/permission-labels.test.ts`
Expected: PASS — 2 test.

- [ ] **Step 5: `roles-query.ts`'i yaz**

`src/server/roles-query.ts`:

```ts
/**
 * Bu dosya BİLEREK 'use server' taşımaz — `channels-query.ts:1-11`'deki
 * gerekçenin aynısı: 'use server' olsaydı export edilen her fonksiyon
 * herkese açık bir RPC uç noktası olur, çağıran POST gövdesinde kendi
 * `actor`'ünü uydurabilirdi.
 */

import { db } from '@/lib/db'
import type { Permission } from '@/lib/auth/policy'

export type RoleSummary = {
  id: string
  name: string
  slug: string
  color: string | null
  permissions: Permission[]
  isSystem: boolean
  position: number
  memberCount: number
}

export type RoleDetail = RoleSummary & {
  members: { id: string; name: string }[]
}

export async function listRoles(): Promise<RoleSummary[]> {
  const roles = await db.role.findMany({
    orderBy: { position: 'asc' },
    include: { _count: { select: { members: true } } },
  })
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    slug: role.slug,
    color: role.color,
    permissions: role.permissions,
    isSystem: role.isSystem,
    position: role.position,
    memberCount: role._count.members,
  }))
}

export async function loadRole(id: string): Promise<RoleDetail | null> {
  const role = await db.role.findUnique({
    where: { id },
    include: {
      members: {
        // Pasif üyeler de görünür: rolü kimden alacağını bilmek yönetim işidir.
        select: { user: { select: { id: true, name: true } } },
        orderBy: { grantedAt: 'asc' },
      },
    },
  })
  if (!role) return null
  return {
    id: role.id,
    name: role.name,
    slug: role.slug,
    color: role.color,
    permissions: role.permissions,
    isSystem: role.isSystem,
    position: role.position,
    memberCount: role.members.length,
    members: role.members.map((m) => m.user),
  }
}
```

- [ ] **Step 6: Doğrula ve commit**

```bash
pnpm typecheck && pnpm lint
git add src/lib/permission-labels.ts src/server/roles-query.ts tests/unit/permission-labels.test.ts
git commit -m "feat: add permission labels and role queries"
```

---

### Task 8: Rol server action'ları

**Files:**
- Create: `src/server/roles.ts`
- Test: `tests/integration/roles.test.ts`

**Interfaces:**
- Consumes: `can(actor, 'role:manage', { kind: 'role' })` (Task 4), `slugify` (`src/lib/slug.ts`), `recordActivity(client, entry)` (`src/lib/activity.ts:5`), `defineAction` / `actionError` (`src/lib/action.ts`).
- Produces:
  - `createRole({ name, color, permissions }) => Result<{ id: string }>`
  - `updateRole({ roleId, name, color, permissions }) => Result<{ id: string }>`
  - `deleteRole({ roleId }) => Result<{ id: string }>`
  - `assignRole({ userId, roleId }) => Result<{ id: string }>`
  - `unassignRole({ userId, roleId }) => Result<{ id: string }>`

- [ ] **Step 1: Write the failing test**

`tests/integration/roles.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

const actorRef: { current: string | null } = { current: null }
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () => {
    if (!actorRef.current) return null
    const user = await db.user.findUniqueOrThrow({
      where: { id: actorRef.current },
      include: {
        memberships: true,
        roles: { select: { role: { select: { permissions: true } } } },
      },
    })
    return {
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
      permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions))],
    }
  },
}))

const { createRole, updateRole, deleteRole, assignRole, unassignRole } =
  await import('@/server/roles')

let superadmin: { id: string }
let admin: { id: string }
let member: { id: string }

beforeEach(async () => {
  await resetDb()
  superadmin = await db.user.create({ data: { name: 'Sahip', globalRole: 'SUPERADMIN' } })
  admin = await db.user.create({ data: { name: 'Başkan', globalRole: 'ADMIN' } })
  member = await db.user.create({ data: { name: 'Üye' } })
})

describe('createRole', () => {
  it('SUPERADMIN rol oluşturur, slug üretir, pozisyon verir', async () => {
    actorRef.current = superadmin.id

    const r = await createRole({
      name: 'Proje Koordinatörlüğü',
      color: '#3b82f6',
      permissions: ['CONTENT_READ_ALL'],
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const role = await db.role.findUniqueOrThrow({ where: { id: r.data.id } })
    expect(role.slug).toBe('proje-koordinatorlugu')
    expect(role.permissions).toEqual(['CONTENT_READ_ALL'])
    expect(role.isSystem).toBe(false)
    expect(role.position).toBe(1)
  })

  it('ikinci rol bir sonraki pozisyonu alır', async () => {
    actorRef.current = superadmin.id
    await createRole({ name: 'Bir', color: null, permissions: [] })
    const second = await createRole({ name: 'İki', color: null, permissions: [] })

    expect(second.ok).toBe(true)
    if (!second.ok) return
    const role = await db.role.findUniqueOrThrow({ where: { id: second.data.id } })
    expect(role.position).toBe(2)
  })

  it('ADMIN rol oluşturamaz', async () => {
    actorRef.current = admin.id
    const r = await createRole({ name: 'Deneme', color: null, permissions: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('her izne sahip bir rol taşıyan üye bile rol oluşturamaz', async () => {
    const godRole = await db.role.create({
      data: {
        name: 'Her Şey', slug: 'her-sey', position: 1,
        permissions: [
          'CONTENT_READ_ALL', 'CONTENT_WRITE_ALL', 'BUDGET_READ_ALL', 'BUDGET_WRITE_ALL',
          'MEMBER_MANAGE', 'INVITE_MANAGE', 'CHANNEL_CREATE', 'CHANNEL_MANAGE_ALL', 'TRASH_MANAGE',
        ],
      },
    })
    await db.userRole.create({ data: { userId: member.id, roleId: godRole.id } })
    actorRef.current = member.id

    const r = await createRole({ name: 'Kendi Rolüm', color: null, permissions: [] })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('aynı adla ikinci rol açılamaz', async () => {
    actorRef.current = superadmin.id
    await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })
    const r = await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })

  it('geçersiz renk reddedilir', async () => {
    actorRef.current = superadmin.id
    const r = await createRole({ name: 'Renkli', color: 'mavi', permissions: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('VALIDATION')
  })
})

describe('updateRole', () => {
  it('izin listesini değiştirir', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const r = await updateRole({
      roleId: created.data.id,
      name: 'Yönetim Kurulu',
      color: '#ef4444',
      permissions: ['CONTENT_READ_ALL', 'BUDGET_READ_ALL'],
    })

    expect(r.ok).toBe(true)
    const role = await db.role.findUniqueOrThrow({ where: { id: created.data.id } })
    expect(role.permissions).toEqual(['CONTENT_READ_ALL', 'BUDGET_READ_ALL'])
    expect(role.color).toBe('#ef4444')
  })

  it('sistem rolünün izinleri değiştirilebilir ama adı değiştirilemez', async () => {
    const system = await db.role.create({
      data: { name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1, isSystem: true },
    })
    actorRef.current = superadmin.id

    const permissionChange = await updateRole({
      roleId: system.id, name: 'Yönetim Kurulu', color: null,
      permissions: ['CONTENT_READ_ALL'],
    })
    expect(permissionChange.ok).toBe(true)

    const rename = await updateRole({
      roleId: system.id, name: 'Başka Ad', color: null, permissions: ['CONTENT_READ_ALL'],
    })
    expect(rename.ok).toBe(false)
    if (!rename.ok) expect(rename.error.code).toBe('CONFLICT')
  })

  it('olmayan rol NOT_FOUND döner', async () => {
    actorRef.current = superadmin.id
    const r = await updateRole({
      roleId: 'clzzzzzzzzzzzzzzzzzzzzzzz', name: 'Yok', color: null, permissions: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })
})

describe('deleteRole', () => {
  it('rolü ve atamalarını siler', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({ name: 'Geçici', color: null, permissions: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await assignRole({ userId: member.id, roleId: created.data.id })

    const r = await deleteRole({ roleId: created.data.id })

    expect(r.ok).toBe(true)
    expect(await db.role.count()).toBe(0)
    expect(await db.userRole.count()).toBe(0)
  })

  it('sistem rolü silinemez', async () => {
    const system = await db.role.create({
      data: { name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1, isSystem: true },
    })
    actorRef.current = superadmin.id

    const r = await deleteRole({ roleId: system.id })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
    expect(await db.role.count()).toBe(1)
  })
})

describe('assignRole / unassignRole', () => {
  it('rolü atar ve veren kişiyi kaydeder', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const r = await assignRole({ userId: member.id, roleId: created.data.id })

    expect(r.ok).toBe(true)
    const assignment = await db.userRole.findFirstOrThrow({ where: { userId: member.id } })
    expect(assignment.grantedById).toBe(superadmin.id)
  })

  it('aynı rolü ikinci kez atamak hata vermez', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    await assignRole({ userId: member.id, roleId: created.data.id })
    const second = await assignRole({ userId: member.id, roleId: created.data.id })

    expect(second.ok).toBe(true)
    expect(await db.userRole.count()).toBe(1)
  })

  it('atamayı kaldırır', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await assignRole({ userId: member.id, roleId: created.data.id })

    const r = await unassignRole({ userId: member.id, roleId: created.data.id })

    expect(r.ok).toBe(true)
    expect(await db.userRole.count()).toBe(0)
  })

  it('ADMIN rol atayamaz', async () => {
    const role = await db.role.create({
      data: { name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1 },
    })
    actorRef.current = admin.id

    const r = await assignRole({ userId: member.id, roleId: role.id })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('olmayan kullanıcıya rol atanamaz', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const r = await assignRole({
      userId: 'clzzzzzzzzzzzzzzzzzzzzzzz', roleId: created.data.id,
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/roles.test.ts`
Expected: FAIL — `@/server/roles` yok.

- [ ] **Step 3: `roles.ts`'i yaz**

`src/server/roles.ts`:

```ts
'use server'

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { actionError, defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can, type Actor, type Permission } from '@/lib/auth/policy'
import { slugify } from '@/lib/slug'
import { recordActivity } from '@/lib/activity'

const permissionSchema = z.enum([
  'CONTENT_READ_ALL',
  'CONTENT_WRITE_ALL',
  'BUDGET_READ_ALL',
  'BUDGET_WRITE_ALL',
  'MEMBER_MANAGE',
  'INVITE_MANAGE',
  'CHANNEL_CREATE',
  'CHANNEL_MANAGE_ALL',
  'TRASH_MANAGE',
])

// Kataloğa yeni bir izin eklenip yukarıdaki listeye yazılmazsa bu satır
// derlenmez: `Permission`, enum'un çıkarımını artık kapsamaz ve tip `never`
// olur. Yetki dağıtılamayan bir izin sessizce ortada kalamaz.
const _permissionsAreExhaustive: Permission extends z.infer<typeof permissionSchema>
  ? true
  : never = true
void _permissionsAreExhaustive

const authorizeRoleManage = async ({ actor }: { actor: Actor }) => ({
  allowed: can(actor, 'role:manage', { kind: 'role' }),
})

const nameSchema = z.string().trim().min(2, 'Rol adı en az 2 karakter olmalı').max(40)
const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Renk #rrggbb biçiminde olmalı')
  .nullable()

export const createRole = defineAction({
  input: z.object({
    name: nameSchema,
    color: colorSchema,
    permissions: z.array(permissionSchema),
  }),
  getActor,
  authorize: authorizeRoleManage,
  handler: async ({ actor, input }) => {
    const slug = slugify(input.name)
    try {
      const role = await db.$transaction(async (tx) => {
        // position tekil: mevcut en büyüğün bir fazlası. Sayım ve yazım aynı
        // transaction'da, iki eş zamanlı oluşturma aynı sayıyı almasın.
        const last = await tx.role.findFirst({
          orderBy: { position: 'desc' }, select: { position: true },
        })
        return tx.role.create({
          data: {
            name: input.name,
            slug,
            color: input.color,
            permissions: input.permissions,
            position: (last?.position ?? 0) + 1,
          },
        })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

      await recordActivity(db, {
        actorId: actor.id, verb: 'role.created',
        entityType: 'Role', entityId: role.id, meta: { name: role.name },
      })
      return { id: role.id }
    } catch (error) {
      throw toRoleError(error)
    }
  },
})

export const updateRole = defineAction({
  input: z.object({
    roleId: z.string().cuid(),
    name: nameSchema,
    color: colorSchema,
    permissions: z.array(permissionSchema),
  }),
  getActor,
  authorize: authorizeRoleManage,
  handler: async ({ actor, input }) => {
    const existing = await db.role.findUnique({ where: { id: input.roleId } })
    if (!existing) throw actionError('NOT_FOUND')
    // Sistem rolünün izinleri değişebilir — kulübün YK'ya ne verdiğini zamanla
    // değiştirmesi meşru. Adı değişemez: kod ve seed onu adıyla tanıyor.
    if (existing.isSystem && input.name !== existing.name) {
      throw actionError('CONFLICT', { name: 'Sistem rolünün adı değiştirilemez.' })
    }

    try {
      await db.role.update({
        where: { id: input.roleId },
        data: {
          name: input.name,
          slug: slugify(input.name),
          color: input.color,
          permissions: input.permissions,
        },
      })
    } catch (error) {
      throw toRoleError(error)
    }

    await recordActivity(db, {
      actorId: actor.id, verb: 'role.updated',
      entityType: 'Role', entityId: input.roleId, meta: { name: input.name },
    })
    return { id: input.roleId }
  },
})

export const deleteRole = defineAction({
  input: z.object({ roleId: z.string().cuid() }),
  getActor,
  authorize: authorizeRoleManage,
  handler: async ({ actor, input }) => {
    const existing = await db.role.findUnique({ where: { id: input.roleId } })
    if (!existing) throw actionError('NOT_FOUND')
    if (existing.isSystem) {
      throw actionError('CONFLICT', { name: 'Sistem rolü silinemez.' })
    }

    // UserRole.roleId onDelete: Cascade — atamalar rolle birlikte gider.
    await db.role.delete({ where: { id: input.roleId } })

    await recordActivity(db, {
      actorId: actor.id, verb: 'role.deleted',
      entityType: 'Role', entityId: input.roleId, meta: { name: existing.name },
    })
    return { id: input.roleId }
  },
})

export const assignRole = defineAction({
  input: z.object({ userId: z.string().cuid(), roleId: z.string().cuid() }),
  getActor,
  authorize: authorizeRoleManage,
  handler: async ({ actor, input }) => {
    const [user, role] = await Promise.all([
      db.user.findUnique({ where: { id: input.userId }, select: { id: true } }),
      db.role.findUnique({ where: { id: input.roleId }, select: { id: true, name: true } }),
    ])
    if (!user || !role) throw actionError('NOT_FOUND')

    // Aynı rolü ikinci kez vermek hata değil, sonuçsuz bir işlemdir:
    // arayüzde çift tıklama kullanıcıya kırmızı bir mesaj göstermemeli.
    await db.userRole.upsert({
      where: { userId_roleId: { userId: input.userId, roleId: input.roleId } },
      create: { userId: input.userId, roleId: input.roleId, grantedById: actor.id },
      update: {},
    })

    await recordActivity(db, {
      actorId: actor.id, verb: 'role.assigned',
      entityType: 'User', entityId: input.userId, meta: { role: role.name },
    })
    return { id: input.userId }
  },
})

export const unassignRole = defineAction({
  input: z.object({ userId: z.string().cuid(), roleId: z.string().cuid() }),
  getActor,
  authorize: authorizeRoleManage,
  handler: async ({ actor, input }) => {
    const role = await db.role.findUnique({
      where: { id: input.roleId }, select: { name: true },
    })
    if (!role) throw actionError('NOT_FOUND')

    await db.userRole.deleteMany({
      where: { userId: input.userId, roleId: input.roleId },
    })

    await recordActivity(db, {
      actorId: actor.id, verb: 'role.unassigned',
      entityType: 'User', entityId: input.userId, meta: { role: role.name },
    })
    return { id: input.userId }
  },
})

/**
 * `name` ve `slug` tekil kısıtları aynı kullanıcı hatasını üretir: aynı adla
 * ikinci bir rol. P2002 dışındaki her şey olduğu gibi yukarı gider.
 */
function toRoleError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return actionError('CONFLICT', { name: 'Bu adda bir rol zaten var.' })
  }
  return error
}
```

- [ ] **Step 4: `activity-labels.ts`'e beş yeni fiili ekle**

`src/lib/activity-labels.ts` içindeki `activityVerbLabels` sözlüğüne (yeni verb eklenip karşılığı yazılmazsa kullanıcı genel yedek metni görür):

```ts
  'role.created': 'bir rol oluşturdu',
  'role.updated': 'bir rolün izinlerini değiştirdi',
  'role.deleted': 'bir rolü sildi',
  'role.assigned': 'bir üyeye rol verdi',
  'role.unassigned': 'bir üyenin rolünü aldı',
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm typecheck && pnpm vitest run tests/integration/roles.test.ts
```
Expected: PASS — 15 test.

- [ ] **Step 6: Commit**

```bash
git add src/server/roles.ts src/lib/activity-labels.ts tests/integration/roles.test.ts
git commit -m "feat: add role management server actions"
```

---

### Task 9: Rol paneli

**Files:**
- Create: `src/components/roles/role-badge.tsx`
- Create: `src/app/(app)/admin/roles/page.tsx`
- Create: `src/app/(app)/admin/roles/role-form.tsx`
- Create: `src/app/(app)/admin/roles/[id]/page.tsx`
- Create: `src/app/(app)/admin/roles/[id]/permission-editor.tsx`
- Modify: `src/app/(app)/admin/page.tsx` (Roller bölümü bağlantısı)

**Interfaces:**
- Consumes: `listRoles()`, `loadRole()` (Task 7); `createRole`, `updateRole`, `deleteRole` (Task 8); `permissionLabels`, `permissionGroupOrder`, `permissionGroupLabels`, `permissionOrder` (Task 7).
- Produces: `<RoleBadge role={{ name: string; color: string | null }} />`

> **`loading.tsx` YOK.** Her iki route da `notFound()` çağırıyor; Suspense sınırı 200'ü akıtıp durumu kilitler (`admin/page.tsx:25-28`).

- [ ] **Step 1: `RoleBadge` bileşenini yaz**

`src/components/roles/role-badge.tsx`:

```tsx
import { cn } from '@/lib/utils'

/**
 * Renk kullanıcı tarafından girilir; arka planı doğrudan o renge boyamak
 * okunabilirliği garanti edemez (koyu mavi üstünde siyah yazı). Renk yalnızca
 * bir nokta olarak kullanılır, metin her zaman tema renginde kalır.
 */
export function RoleBadge({
  role, className,
}: {
  role: { name: string; color: string | null }
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
        className,
      )}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ backgroundColor: role.color ?? 'var(--color-muted-foreground)' }}
      />
      {role.name}
    </span>
  )
}
```

- [ ] **Step 2: Rol listesi sayfasını yaz**

`src/app/(app)/admin/roles/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { listRoles } from '@/server/roles-query'
import { EmptyState } from '@/components/state/empty-state'
import { PageContainer, PageHeader, SectionHeading } from '@/components/layout/page'
import { RoleBadge } from '@/components/roles/role-badge'
import { RoleForm } from './role-form'

// Bu route'a KASITLI OLARAK loading.tsx eklenmez — bkz. admin/page.tsx:25-28.
export default async function RolesPage() {
  const actor = await requireActor()
  if (!can(actor, 'role:manage', { kind: 'role' })) notFound()

  const roles = await listRoles()

  return (
    <PageContainer className="space-y-8">
      <PageHeader title="Roller" />

      <section className="space-y-3">
        <SectionHeading>Yeni rol</SectionHeading>
        <RoleForm />
      </section>

      <section className="space-y-2">
        <SectionHeading>Tanımlı roller</SectionHeading>
        {roles.length === 0 ? (
          <EmptyState
            title="Rol yok"
            description="Henüz hiç rol tanımlanmadı. Yukarıdaki formdan ilkini oluştur."
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {roles.map((role) => (
              <li key={role.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex items-center gap-2">
                  <RoleBadge role={role} />
                  {role.isSystem && (
                    <span className="text-xs text-muted-foreground">sistem rolü</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>{role.memberCount} üye</span>
                  <span>
                    {role.permissions.length === 0
                      ? 'izin yok'
                      : `${role.permissions.length} izin`}
                  </span>
                  <Link className="underline" href={`/admin/roles/${role.id}`}>
                    Düzenle
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  )
}
```

- [ ] **Step 3: Rol oluşturma formunu yaz**

`src/app/(app)/admin/roles/role-form.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createRole } from '@/server/roles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function RoleForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#64748b')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      // İzinler burada boş: rol önce açılır, izinleri detay sayfasında
      // işaretlenir. Tek adımda ikisini birden sormak formu şişiriyordu.
      const result = await createRole({ name, color, permissions: [] })
      if (!result.ok) {
        setError(result.error.fields?.name ?? result.error.message)
        return
      }
      setName('')
      router.refresh()
    })
  }

  return (
    <form className="flex flex-wrap items-end gap-3 rounded-lg border p-4" onSubmit={handleSubmit}>
      <div className="space-y-1">
        <Label htmlFor="role-name">Rol adı</Label>
        <Input
          id="role-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Yönetim Kurulu"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="role-color">Renk</Label>
        <Input
          id="role-color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-16 p-1"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Oluşturuluyor…' : 'Rol oluştur'}
      </Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 4: Rol detay sayfasını yaz**

`src/app/(app)/admin/roles/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { loadRole } from '@/server/roles-query'
import { EmptyState } from '@/components/state/empty-state'
import { PageContainer, PageHeader, SectionHeading } from '@/components/layout/page'
import { PermissionEditor } from './permission-editor'

// Bu route'a KASITLI OLARAK loading.tsx eklenmez — bkz. admin/page.tsx:25-28.
export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const actor = await requireActor()
  if (!can(actor, 'role:manage', { kind: 'role' })) notFound()

  const { id } = await params
  const role = await loadRole(id)
  if (!role) notFound()

  return (
    <PageContainer className="space-y-8">
      <PageHeader title={role.name} />

      <section className="space-y-3">
        <SectionHeading>İzinler</SectionHeading>
        <PermissionEditor
          roleId={role.id}
          name={role.name}
          color={role.color}
          permissions={role.permissions}
          isSystem={role.isSystem}
        />
      </section>

      <section className="space-y-2">
        <SectionHeading>Bu roldeki üyeler</SectionHeading>
        {role.members.length === 0 ? (
          <EmptyState
            title="Üye yok"
            description="Bu rol henüz kimseye verilmedi. Üyeler sayfasından atayabilirsin."
          />
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {role.members.map((m) => (
              <li key={m.id} className="px-3 py-2">{m.name}</li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  )
}
```

- [ ] **Step 5: İzin editörünü yaz**

`src/app/(app)/admin/roles/[id]/permission-editor.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Permission } from '@/lib/auth/policy'
import { deleteRole, updateRole } from '@/server/roles'
import {
  permissionGroupLabels, permissionGroupOrder, permissionLabels, permissionOrder,
} from '@/lib/permission-labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function PermissionEditor({
  roleId, name: initialName, color: initialColor, permissions: initialPermissions, isSystem,
}: {
  roleId: string
  name: string
  color: string | null
  permissions: Permission[]
  isSystem: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor ?? '#64748b')
  const [selected, setSelected] = useState<Set<Permission>>(new Set(initialPermissions))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function toggle(permission: Permission) {
    setSaved(false)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(permission)) next.delete(permission)
      else next.add(permission)
      return next
    })
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const result = await updateRole({
        roleId,
        name,
        color,
        // permissionOrder üzerinden geçmek listeyi her zaman aynı sırada
        // gönderir — kaydet/yükle turunda sıra kayması olmaz.
        permissions: permissionOrder.filter((p) => selected.has(p)),
      })
      if (!result.ok) {
        setError(result.error.fields?.name ?? result.error.message)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  function handleDelete() {
    if (!window.confirm(`${initialName} rolü silinsin mi? Bu roldeki herkes izinlerini kaybeder.`)) {
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await deleteRole({ roleId })
      if (!result.ok) {
        setError(result.error.fields?.name ?? result.error.message)
        return
      }
      router.push('/admin/roles')
    })
  }

  return (
    <div className="space-y-5 rounded-lg border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="role-name">Rol adı</Label>
          <Input
            id="role-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false) }}
            disabled={isSystem}
          />
          {isSystem && (
            <p className="text-xs text-muted-foreground">
              Sistem rolünün adı değiştirilemez; izinleri değiştirilebilir.
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="role-color">Renk</Label>
          <Input
            id="role-color"
            type="color"
            value={color}
            onChange={(e) => { setColor(e.target.value); setSaved(false) }}
            className="h-9 w-16 p-1"
          />
        </div>
      </div>

      {permissionGroupOrder.map((group) => (
        <fieldset key={group} className="space-y-2">
          <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {permissionGroupLabels[group]}
          </legend>
          {permissionOrder
            .filter((permission) => permissionLabels[permission].group === group)
            .map((permission) => (
              <label key={permission} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={selected.has(permission)}
                  onChange={() => toggle(permission)}
                  disabled={pending}
                />
                {permissionLabels[permission].label}
              </label>
            ))}
        </fieldset>
      ))}

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={handleSave} disabled={pending}>
          {pending ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
        {!isSystem && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={pending}
          >
            Rolü sil
          </Button>
        )}
        {saved && <span className="text-sm text-muted-foreground">Kaydedildi.</span>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 6: Yönetim sayfasına bağlantı ekle**

`src/app/(app)/admin/page.tsx` içinde "Kanallar" bölümünden önce, `can(actor, 'role:manage', { kind: 'role' })` doğruysa görünen bir bölüm ekle:

```tsx
      {can(actor, 'role:manage', { kind: 'role' }) && (
        <section className="space-y-2">
          <SectionHeading>Roller</SectionHeading>
          <p className="text-sm text-muted-foreground">
            Kulüp geneli kademeler ve izinleri.{' '}
            <Link className="underline" href="/admin/roles">Rolleri yönet</Link>
          </p>
        </section>
      )}
```

Dosyanın başına `import Link from 'next/link'` ekle.

- [ ] **Step 7: Doğrula**

```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: üçü de temiz.

- [ ] **Step 8: Elle doğrula**

`pnpm dev` çalıştır, SUPERADMIN olarak `/admin/roles` aç:
- Rol oluştur → listede rozetle görünür
- Detayına gir → izin kutucukları gruplu ve Türkçe
- Bir izin işaretle, Kaydet → sayfa yenilenince işaretli kalır
- ADMIN kullanıcıyla `/admin/roles` → 404

- [ ] **Step 9: Commit**

```bash
git add src/components/roles "src/app/(app)/admin"
git commit -m "feat: add the role management panel"
```

---

### Task 10: Üyeler sayfasında rozet ve rol atama

**Files:**
- Modify: `src/app/(app)/members/page.tsx` (select'e roller, `Rol` sütunu, `MemberActions` prop'ları)
- Modify: `src/app/(app)/members/member-actions.tsx`
- Test: `tests/integration/roles.test.ts` (mevcut dosyaya vaka)

**Interfaces:**
- Consumes: `RoleBadge` (Task 9), `assignRole` / `unassignRole` (Task 8), `listRoles()` (Task 7).
- Produces: `MemberActions` prop'ları `{ userId, name, globalRole, isActive, isSelf, canManageRoles, allRoles, assignedRoleIds }`.

- [ ] **Step 1: Write the failing test**

`tests/integration/roles.test.ts` sonuna ekle:

```ts
describe('rol atama sonrası izinler', () => {
  it('rol atanan üye o rolün izinlerini anında kazanır', async () => {
    const { getActor } = await import('@/lib/auth/session')
    actorRef.current = superadmin.id
    const created = await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await updateRole({
      roleId: created.data.id, name: 'Yönetim Kurulu', color: null,
      permissions: ['CONTENT_READ_ALL'],
    })
    await assignRole({ userId: member.id, roleId: created.data.id })

    actorRef.current = member.id
    const actor = await getActor()

    expect(actor?.permissions).toEqual(['CONTENT_READ_ALL'])
  })

  it('rol geri alınınca izin de anında gider', async () => {
    const { getActor } = await import('@/lib/auth/session')
    actorRef.current = superadmin.id
    const created = await createRole({
      name: 'Yönetim Kurulu', color: null, permissions: [],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await updateRole({
      roleId: created.data.id, name: 'Yönetim Kurulu', color: null,
      permissions: ['CONTENT_READ_ALL'],
    })
    await assignRole({ userId: member.id, roleId: created.data.id })
    await unassignRole({ userId: member.id, roleId: created.data.id })

    actorRef.current = member.id
    const actor = await getActor()

    expect(actor?.permissions).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `pnpm vitest run tests/integration/roles.test.ts`
Expected: PASS — Task 2 ve 8 bunu zaten sağlıyor. Bu iki test, "izinler token'da taşınmaz, her istekte tazelenir" güvencesinin regresyon kilididir; geçiyorsa bir sonraki adıma geç.

- [ ] **Step 3: `members/page.tsx`'i güncelle**

Sorgu `select` bloğuna rolleri ekle (satır 31-40):

```ts
    select: {
      id: true,
      name: true,
      title: true,
      globalRole: true,
      isActive: true,
      memberships: {
        select: { channel: { select: { id: true, name: true, visibility: true } } },
      },
      roles: {
        select: { role: { select: { id: true, name: true, color: true, position: true } } },
        orderBy: { role: { position: 'asc' } },
      },
    },
```

Rol yönetimi yetkisini ve rol listesini hesapla (satır 18'in yanına):

```ts
  const canManageRoles = can(actor, 'role:manage', { kind: 'role' })
  const allRoles = canManageRoles ? await listRoles() : []
```

Import satırları:

```ts
import { can, has } from '@/lib/auth/policy'
import { listRoles } from '@/server/roles-query'
import { RoleBadge } from '@/components/roles/role-badge'
```

`Rol` sütununu (satır 95) rozetlere çevir:

```tsx
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {m.globalRole !== 'MEMBER' && (
                      <RoleBadge
                        role={{
                          name: m.globalRole === 'SUPERADMIN' ? 'Sistem sahibi' : 'Yönetici',
                          color: null,
                        }}
                      />
                    )}
                    {m.roles.map(({ role }) => (
                      <RoleBadge key={role.id} role={role} />
                    ))}
                    {m.globalRole === 'MEMBER' && m.roles.length === 0 && (
                      <span className="text-muted-foreground">Üye</span>
                    )}
                  </div>
                </td>
```

`MemberActions` çağrısına (satır 102-108) üç prop ekle:

```tsx
                    <MemberActions
                      userId={m.id}
                      name={m.name}
                      globalRole={m.globalRole}
                      isActive={m.isActive}
                      isSelf={m.id === actor.id}
                      canManageRoles={canManageRoles}
                      allRoles={allRoles.map((r) => ({ id: r.id, name: r.name }))}
                      assignedRoleIds={m.roles.map(({ role }) => role.id)}
                    />
```

Ayrıca "İşlemler" sütunu artık rol atamayı da barındırdığı için, sütunun görünme koşulu (satır 82, 100) `canManageMembers || canManageRoles` olmalı.

- [ ] **Step 4: `member-actions.tsx`'i güncelle**

`src/app/(app)/members/member-actions.tsx` — `roleLabels` sözlüğünü ve prop tipini genişlet, rol atama bölümü ekle:

```tsx
import { assignRole, unassignRole } from '@/server/roles'

const roleLabels: Record<'SUPERADMIN' | 'ADMIN' | 'MEMBER', string> = {
  SUPERADMIN: 'Sistem sahibi',
  ADMIN: 'Yönetici',
  MEMBER: 'Üye',
}

export function MemberActions({
  userId, name, globalRole, isActive, isSelf, canManageRoles, allRoles, assignedRoleIds,
}: {
  userId: string
  name: string
  globalRole: 'SUPERADMIN' | 'ADMIN' | 'MEMBER'
  isActive: boolean
  isSelf: boolean
  canManageRoles: boolean
  allRoles: { id: string; name: string }[]
  assignedRoleIds: string[]
}) {
```

`handleRoleChange` imzasını üç değere aç:

```tsx
  function handleRoleChange(nextRole: 'SUPERADMIN' | 'ADMIN' | 'MEMBER') {
```

`<SelectContent>` içine üçüncü seçeneği ekle:

```tsx
            <SelectItem value="MEMBER">Üye</SelectItem>
            <SelectItem value="ADMIN">Yönetici</SelectItem>
            <SelectItem value="SUPERADMIN">Sistem sahibi</SelectItem>
```

`onValueChange` cast'ini de güncelle: `value as 'SUPERADMIN' | 'ADMIN' | 'MEMBER'`.

Rol atama işleyicisi ve arayüzü (dönüş bloğundaki `<div className="flex items-center gap-2">`'nin altına):

```tsx
  function handleToggleRole(roleId: string, assigned: boolean) {
    setError(null)
    startTransition(async () => {
      const result = assigned
        ? await unassignRole({ userId, roleId })
        : await assignRole({ userId, roleId })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.refresh()
    })
  }
```

```tsx
      {canManageRoles && allRoles.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {allRoles.map((role) => {
            const assigned = assignedRoleIds.includes(role.id)
            return (
              <Button
                key={role.id}
                type="button"
                size="sm"
                variant={assigned ? 'default' : 'outline'}
                disabled={pending}
                onClick={() => handleToggleRole(role.id, assigned)}
                aria-pressed={assigned}
              >
                {role.name}
              </Button>
            )
          })}
        </div>
      )}
```

- [ ] **Step 5: Doğrula**

```bash
pnpm typecheck && pnpm lint && pnpm test
```
Expected: PASS.

- [ ] **Step 6: Elle doğrula**

`pnpm dev` — SUPERADMIN olarak `/members`: rol düğmeleri görünür, tıklayınca rozet satırda anında beliriyor; ADMIN olarak: rol düğmeleri yok, üye işlemleri var.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/members" tests/integration/roles.test.ts
git commit -m "feat: show role badges and assign roles from the members page"
```

---

### Task 11: Seed, kurulum daveti ve davet formu

**Files:**
- Modify: `prisma/seed.ts`
- Modify: `src/server/invite-service.ts:82-84` (**kurulum akışını kıran defekt**)
- Modify: `src/server/invites.ts:12-18` (girdi şeması + authorize)
- Modify: `src/app/(app)/admin/create-invite-form.tsx`
- Modify: `src/app/(app)/admin/page.tsx` (forma yetki bilgisi geçir)
- Test: `tests/integration/seed.test.ts`, `tests/integration/invites.test.ts`
- Create: `tests/integration/invite-actions.test.ts`

**Interfaces:**
- Consumes: Task 1 şeması, Task 7 `permissionOrder`.
- Produces: `seedSystemRoles(): Promise<void>` — `prisma/seed.ts`'ten export edilir; kurulum daveti artık `globalRole: 'SUPERADMIN'` üretir.

- [ ] **Step 1: Write the failing test**

`tests/integration/seed.test.ts` sonuna ekle (dosyanın mevcut import ve `beforeEach` desenini koru):

```ts
describe('seedSystemRoles', () => {
  it('üç sistem rolünü izinleriyle birlikte kurar', async () => {
    const { seedSystemRoles } = await import('../../prisma/seed')

    await seedSystemRoles()

    const roles = await db.role.findMany({ orderBy: { position: 'asc' } })
    expect(roles.map((r) => r.name)).toEqual([
      'Yönetim Kurulu', 'Genel Sekreter', 'İnsan Kaynakları',
    ])
    expect(roles.every((r) => r.isSystem)).toBe(true)

    const board = roles[0]!
    // Yönetim Kurulu her şeye erişir; rol yönetimi hariç, o SUPERADMIN'de.
    expect(board.permissions).toContain('CONTENT_READ_ALL')
    expect(board.permissions).toContain('CONTENT_WRITE_ALL')
    expect(board.permissions).toContain('BUDGET_WRITE_ALL')
    expect(board.permissions).toContain('TRASH_MANAGE')
  })

  it('ikinci kez çalıştırılınca kopya üretmez', async () => {
    const { seedSystemRoles } = await import('../../prisma/seed')

    await seedSystemRoles()
    await seedSystemRoles()

    expect(await db.role.count()).toBe(3)
  })
})

describe('kurulum daveti', () => {
  it('SUPERADMIN yetkili davet üretir', async () => {
    const { seedBootstrapInvite } = await import('../../prisma/seed')

    const result = await seedBootstrapInvite()

    expect(result.ok).toBe(true)
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.globalRole).toBe('SUPERADMIN')
  })
})
```

`tests/integration/invites.test.ts`'te `seedInvite` yardımcısının `globalRole` tipini genişlet (satır 26-33 civarı):

```ts
    globalRole: 'SUPERADMIN' | 'ADMIN' | 'MEMBER'
```

ve dosyaya `consumeInvite`'ı sınayan bloğun yanına ekle:

```ts
it('SUPERADMIN daveti kullanıcıyı SUPERADMIN yapar', async () => {
  const newcomer = await db.user.create({ data: { name: 'Sahip' } })
  const { invite } = await seedInvite({ globalRole: 'SUPERADMIN', channelId: null })

  const r = await consumeInvite(invite.id, newcomer.id)

  expect(r.ok).toBe(true)
  const updated = await db.user.findUniqueOrThrow({ where: { id: newcomer.id } })
  expect(updated.globalRole).toBe('SUPERADMIN')
})
```

> `seedInvite`'ın dönüş şekli dosyada tanımlı; `{ invite }` yerine doğrudan `invite` döndürüyorsa çağrıyı ona göre yaz.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/seed.test.ts`
Expected: FAIL — `seedSystemRoles` export edilmiyor, davet `ADMIN` üretiyor.

- [ ] **Step 3: `seed.ts`'i güncelle**

`prisma/seed.ts` içinde kurulum davetinin `globalRole` değerini `'SUPERADMIN'` yap (dosyanın başındaki açıklama bloğundaki "ADMIN yetkili" ifadesini de "SUPERADMIN yetkili" olarak düzelt; `events.createUser` yorumu da aynı şekilde).

Dosyaya ekle:

```ts
/**
 * Kulübün örgüt şemasındaki kademeler. `isSystem: true` oldukları için
 * silinemezler ve adları değişmez — kod ve bu seed onları adlarıyla tanır.
 * İzinleri panelden değiştirilebilir: kulübün YK'ya ne verdiğini zamanla
 * değiştirmesi meşru bir ihtiyaç.
 *
 * Rol YÖNETİMİ bilerek burada yok — o bir izin değil, SUPERADMIN kapısı.
 */
const SYSTEM_ROLES = [
  {
    name: 'Yönetim Kurulu',
    slug: 'yonetim-kurulu',
    color: '#2563eb',
    position: 1,
    permissions: [
      'CONTENT_READ_ALL', 'CONTENT_WRITE_ALL',
      'BUDGET_READ_ALL', 'BUDGET_WRITE_ALL',
      'MEMBER_MANAGE', 'INVITE_MANAGE',
      'CHANNEL_CREATE', 'CHANNEL_MANAGE_ALL', 'TRASH_MANAGE',
    ],
  },
  {
    name: 'Genel Sekreter',
    slug: 'genel-sekreter',
    color: '#7c3aed',
    position: 2,
    permissions: ['CONTENT_READ_ALL', 'INVITE_MANAGE', 'TRASH_MANAGE'],
  },
  {
    name: 'İnsan Kaynakları',
    slug: 'insan-kaynaklari',
    color: '#059669',
    position: 3,
    permissions: ['MEMBER_MANAGE', 'INVITE_MANAGE'],
  },
] as const

/**
 * Her deploy'da çalışabilir olmalı: var olan rolün izinlerini EZMEZ, yalnızca
 * eksik olanı ekler. Aksi halde panelden yapılan her ayar bir sonraki
 * deploy'da geri alınırdı.
 */
export async function seedSystemRoles(): Promise<void> {
  for (const role of SYSTEM_ROLES) {
    const existing = await db.role.findUnique({ where: { slug: role.slug } })
    if (existing) continue
    await db.role.create({
      data: {
        name: role.name,
        slug: role.slug,
        color: role.color,
        position: role.position,
        isSystem: true,
        permissions: [...role.permissions],
      },
    })
  }
}
```

`seed.ts`'in `main` / CLI giriş noktasında `seedSystemRoles()`'ı `seedBootstrapInvite()`'ten **önce** çağır (roller kullanıcıdan bağımsız, her zaman kurulmalı).

- [ ] **Step 4: `invite-service.ts`'teki kurulum defektini düzelt**

`src/server/invite-service.ts:82-84` daveti kabul ederken yalnızca tek bir değeri tanıyor:

```ts
    if (invite.globalRole === 'ADMIN') {
      await tx.user.update({ where: { id: userId }, data: { globalRole: 'ADMIN' } })
    }
```

Üç değerli enum'da bu satır **SUPERADMIN davetini sessizce yutar**: davetli giriş yapar, `MEMBER` olarak açılır, sistemde hiç SUPERADMIN kalmaz ve rol paneli kimseye açılmaz. Step 3'teki seed değişikliği bu düzeltme olmadan tamamen etkisizdir.

```ts
    // Davetin taşıdığı kademe ne ise o uygulanır. Tek bir değeri isimle
    // kontrol etmek, enum büyüdüğünde sessizce yetki düşüren bir desendi.
    if (invite.globalRole !== 'MEMBER') {
      await tx.user.update({
        where: { id: userId },
        data: { globalRole: invite.globalRole },
      })
    }
```

- [ ] **Step 5: Davet akışını üç değere aç**

`src/server/invites.ts:12-16`:

```ts
  input: z.object({
    globalRole: z.enum(['SUPERADMIN', 'ADMIN', 'MEMBER']).default('MEMBER'),
    channelId: z.string().cuid().nullable().default(null),
    channelRole: z.enum(['LEAD', 'MEMBER']).default('MEMBER'),
  }),
```

`src/app/(app)/admin/create-invite-form.tsx` — prop ve durum tipini genişlet, SUPERADMIN seçeneğini koşullu göster:

```tsx
export function CreateInviteForm({
  channels, canGrantSuperadmin,
}: {
  channels: { id: string; name: string }[]
  canGrantSuperadmin: boolean
}) {
  const [globalRole, setGlobalRole] = useState<'SUPERADMIN' | 'ADMIN' | 'MEMBER'>('MEMBER')
```

```tsx
          <Select
            value={globalRole}
            onValueChange={(v) => setGlobalRole(v as 'SUPERADMIN' | 'ADMIN' | 'MEMBER')}
          >
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MEMBER">Üye</SelectItem>
              <SelectItem value="ADMIN">Yönetici</SelectItem>
              {/* Sistem sahibi yetkisini yalnızca sistem sahibi dağıtabilir.
                  Bu gizleme bir kolaylık; asıl kapı sunucuda (bkz. aşağıdaki not). */}
              {canGrantSuperadmin && (
                <SelectItem value="SUPERADMIN">Sistem sahibi</SelectItem>
              )}
            </SelectContent>
          </Select>
```

`src/app/(app)/admin/page.tsx` içindeki `<CreateInviteForm channels={channels} />` çağrısına ekle:

```tsx
        <CreateInviteForm
          channels={channels}
          canGrantSuperadmin={actor.globalRole === 'SUPERADMIN'}
        />
```

**Sunucu kapısı zorunlu** — seçeneği gizlemek yetkilendirme değil. `src/server/invites.ts` içindeki `createInvite`'ın `authorize` bloğunu değiştir:

```ts
  authorize: async ({ actor, input }) => {
    if (!can(actor, 'invite:create', { kind: 'invite' })) return { allowed: false }
    // SUPERADMIN yetkisi yalnızca SUPERADMIN tarafından dağıtılabilir:
    // aksi halde INVITE_MANAGE taşıyan biri kendine sistem sahibi daveti üretir.
    if (input.globalRole === 'SUPERADMIN' && actor.globalRole !== 'SUPERADMIN') {
      return { allowed: false }
    }
    return { allowed: true }
  },
```

- [ ] **Step 6: Write the failing test (yetki yükseltme)**

`tests/integration/invites.test.ts` `createInvite` server action'ını değil `invite-service`'i doğrudan sınıyor ve `getActor` mock'u taşımıyor. Bu yüzden yeni dosya:

`tests/integration/invite-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

const actorRef: { current: string | null } = { current: null }
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () => {
    if (!actorRef.current) return null
    const user = await db.user.findUniqueOrThrow({
      where: { id: actorRef.current },
      include: {
        memberships: true,
        roles: { select: { role: { select: { permissions: true } } } },
      },
    })
    return {
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
      permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions))],
    }
  },
}))

const { createInvite } = await import('@/server/invites')

let superadmin: { id: string }
let hr: { id: string }

beforeEach(async () => {
  await resetDb()
  superadmin = await db.user.create({ data: { name: 'Sahip', globalRole: 'SUPERADMIN' } })
  const role = await db.role.create({
    data: {
      name: 'İnsan Kaynakları', slug: 'insan-kaynaklari', position: 1,
      permissions: ['INVITE_MANAGE'],
    },
  })
  hr = await db.user.create({ data: { name: 'İK' } })
  await db.userRole.create({ data: { userId: hr.id, roleId: role.id } })
})

describe('createInvite', () => {
  it('INVITE_MANAGE taşıyan üye davet üretir', async () => {
    actorRef.current = hr.id

    const r = await createInvite({ globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER' })

    expect(r.ok).toBe(true)
  })

  // Aksi halde INVITE_MANAGE taşıyan biri kendine sistem sahibi daveti üretip
  // bağlantıyı kendi açarak sınırsız yetkiye çıkardı.
  it('SUPERADMIN olmayan, SUPERADMIN daveti üretemez', async () => {
    actorRef.current = hr.id

    const r = await createInvite({
      globalRole: 'SUPERADMIN', channelId: null, channelRole: 'MEMBER',
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
    expect(await db.invite.count()).toBe(0)
  })

  it('SUPERADMIN, SUPERADMIN daveti üretebilir', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'SUPERADMIN', channelId: null, channelRole: 'MEMBER',
    })

    expect(r.ok).toBe(true)
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.globalRole).toBe('SUPERADMIN')
  })
})
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
pnpm typecheck && pnpm vitest run tests/integration/seed.test.ts tests/integration/invites.test.ts tests/integration/invite-actions.test.ts
```
Expected: PASS.

- [ ] **Step 8: Seed'i gerçek veritabanında çalıştır**

```bash
pnpm db:seed
```
Expected: üç sistem rolü oluşur. Tekrar çalıştır — kopya üretmemeli.

- [ ] **Step 9: Commit**

```bash
git add prisma/seed.ts src/server/invites.ts src/server/invite-service.ts "src/app/(app)/admin" tests/integration
git commit -m "feat: seed system roles and gate superadmin invites"
```

---

### Task 12: Uçtan uca doğrulama

**Files:**
- Modify: `tests/e2e/authorization.spec.ts`

**Interfaces:**
- Consumes: `signInAs(context, userId)` (`tests/e2e/helpers/session.ts:7`).

> Bu takımın en kritik testi. Diğer her şey yanlışsa fazla yetki verilir; **bu** yanlışsa gizli içerik sızar.

- [ ] **Step 1: Write the failing test**

`tests/e2e/authorization.spec.ts` sonuna ekle:

```ts
test('YK rolü yönetime özel kanalı açar, düz üye kanalı hiç göremez', async ({ page, context, browser }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const owner = await db.user.create({
    data: { name: 'Sahip', email: `s-${stamp}@x.com`, globalRole: 'SUPERADMIN', onboardedAt: new Date() },
  })
  const role = await db.role.create({
    data: {
      name: `Yönetim Kurulu ${stamp}`,
      slug: `yonetim-kurulu-${stamp}`,
      // position tekil kısıt taşıyor; paralel worker'lar aynı milisaniyede
      // çalışabildiği için zaman damgası değil rastgele sayı kullanılır.
      position: Math.floor(Math.random() * 1_000_000_000),
      permissions: ['CONTENT_READ_ALL', 'CONTENT_WRITE_ALL'],
    },
  })
  const boardMember = await db.user.create({
    data: { name: 'YK Üyesi', email: `y-${stamp}@x.com`, onboardedAt: new Date() },
  })
  await db.userRole.create({ data: { userId: boardMember.id, roleId: role.id } })
  const plainMember = await db.user.create({
    data: { name: 'Düz Üye', email: `d-${stamp}@x.com`, onboardedAt: new Date() },
  })

  const channelName = `Yönetim ${stamp}`
  const channelSlug = `yonetim-${stamp}`
  await db.channel.create({
    data: {
      name: channelName, slug: channelSlug, visibility: 'PRIVATE',
      createdById: owner.id, members: { create: { userId: owner.id, channelRole: 'LEAD' } },
    },
  })

  // YK üyesi: kanala ÜYE OLMADAN erişebilmeli — erişim rolden geliyor.
  await signInAs(context, boardMember.id)
  const allowed = await page.goto(`/c/${channelSlug}`)
  expect(allowed?.status()).toBe(200)
  await expect(page.getByText(channelName).first()).toBeVisible()

  // Düz üye: aynı kanal 404. Kanal adı yanıtın hiçbir yerinde geçmemeli.
  const plainContext = await browser.newContext()
  const plainPage = await plainContext.newPage()
  await signInAs(plainContext, plainMember.id)
  const forbidden = await plainPage.goto(`/c/${channelSlug}`)
  expect(forbidden?.status()).toBe(404)
  expect((await forbidden?.text()) ?? '').not.toContain(channelName)
  await plainContext.close()
})
```

- [ ] **Step 2: Run test**

Önce `pnpm dev` çalışıyorsa **kapat** (açık dev sunucusu her spec'i login sayfasında düşürür), sonra:

Run: `pnpm test:e2e tests/e2e/authorization.spec.ts`
Expected: PASS. FAIL alırsan Task 3 (`can()`) veya Task 5 (liste kapsamı) eksik uygulanmış demektir.

- [ ] **Step 3: Tüm takımı koştur**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
```
Expected: hepsi temiz.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/authorization.spec.ts
git commit -m "test: verify board-only channel access end to end"
```

---

## Uygulama sonrası kontrol listesi

- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:e2e` — dördü de temiz
- [ ] Üretimde göç sırası: `pnpm db:deploy` üç migration'ı sırayla uygular; sonra `pnpm db:seed`
- [ ] `SELECT id, name, "globalRole" FROM "User" WHERE "globalRole" = 'SUPERADMIN';` — en az bir satır dönmeli
- [ ] Başkan hesabı SUPERADMIN'e yükseltildi (`/members` üzerinden, sistem sahibi tarafından)
- [ ] "Yönetim Kurulu" adında PRIVATE bir kanal açıldı ve düz bir üye hesabıyla görünmediği doğrulandı
