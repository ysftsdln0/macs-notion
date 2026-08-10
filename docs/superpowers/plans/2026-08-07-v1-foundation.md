# MACS v1 — Plan 1: Temel (Kimlik, Kanal, Yetki, Altyapı) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kulüp üyesinin davet linkiyle Google üzerinden giriş yapıp profilini kurabildiği, kanalları görebildiği ve yönetebildiği, tüm yetki kurallarının test edilmiş tek bir noktadan işlediği, container'larda çalışan ve sunucuya deploy edilebilen bir temel uygulama.

**Architecture:** Tek Next.js 16 App Router uygulaması, Postgres 16 ile Prisma üzerinden konuşur. Kimlik Auth.js v5 + Google provider, oturum veritabanında. Tüm yetkilendirme `src/lib/auth/policy.ts` içindeki saf `can()` fonksiyonunda toplanır ve her server action veriye dokunmadan önce onu çağırır. Docker Compose ile dört container (`caddy`, `web`, `collab`, `db`) — bu planda `collab` henüz devrede değildir, Plan 2'de gelir.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind CSS, shadcn/ui, Prisma 6 + Postgres 16, Auth.js v5 (next-auth@5), Zod, Vitest, Playwright, Docker Compose, Caddy, GitHub Actions + GHCR.

## Global Constraints

Bu bölüm her task'ın gereksinimlerine örtük olarak dahildir.

- **TypeScript strict** — `any` yok, `strict: true`, `noUncheckedIndexedAccess: true`.
- **Yetki kontrolü veriye dokunmadan önce yapılır.** Her server action ve route handler ilk iş `can()` çağırır. Arayüzde buton gizlemek güvenlik sınırı değildir.
- **Server action dönüş tipi her zaman `Result<T>`** — `{ ok: true, data: T } | { ok: false, error: AppError }`. Exception fırlatıp UI'da yakalama deseni kullanılmaz.
- **Girdi doğrulama Zod ile**, hata mesajları alan bazında döner.
- **Soft delete — içerik varlıklarında.** `Document`, `Task`, `Event`, `Sponsor`, `BudgetEntry`, `Channel` gibi içerik varlıklarında silme `archivedAt` set eder, satır silinmez. **Join tabloları muaftır** (`ChannelMember`, `Assignee`, `DocumentShare`): bunlar gerçekten silinir. Sebebi teknik: `@@unique([channelId, userId])` gibi kısıtlar arşivlenmiş satır yüzünden aynı kişinin yeniden eklenmesini bloklar. Kayıt zaten `Activity` tablosuna düşer, geri alma tek işlemdir.
- **Para alanları `@db.Decimal(12, 2)`**, float kullanılmaz. (Bu planda para alanı yok; kural sonraki planlar için geçerlidir.)
- **Davet token'ı veritabanında SHA-256 hash olarak saklanır**, ham token yalnızca linkte bulunur.
- **Her ekranda dört durum:** yükleniyor (skeleton) / hata (+tekrar dene) / boş (+eylem) / dolu.
- **Arayüzde "Private" kelimesi kullanılmaz.** Doküman görünürlüğü etiketi "Sadece ben", alt not "Yöneticiler erişebilir". Kod içindeki enum `PRIVATE` olarak kalır.
- **Paket yöneticisi pnpm**, Node 22.
- **Commit mesajları Conventional Commits.**
- **`'use server'` modülünde yalnızca gerçek action bulunur.** Böyle bir dosyanın *her* export'u ağdan çağrılabilir bir uç noktadır — sorgu yardımcıları, saf fonksiyonlar ve `Actor` gibi bir parametreyi çağırandan alan hiçbir şey oraya konmaz. Çağırandan gelen `Actor` sahte olabilir; kimlik her zaman sunucuda `getActor()` ile çözülür.
- **Yerel port haritası:** geliştirme makinesinde 5432 ve 3000 başka bir proje tarafından tutuluyor. Bu yüzden **Postgres host portu 5433**, **web dev/start portu 3100**. Container içi portlar (5432, 3000) ve CI/production portları değişmez — yalnızca host tarafındaki eşleme kayar. Buna bağlı olarak yerel `DATABASE_URL` 5433'e, `AUTH_URL` `http://localhost:3100`'e işaret eder.

---

## Dosya Yapısı

```
compose.yml                     prod: caddy + web + collab + db
compose.dev.yml                 dev: yalnızca db (web host'ta `pnpm dev` ile)
Caddyfile                       reverse proxy + otomatik HTTPS
Dockerfile                      web imajı (multi-stage, standalone output)
.env.example                    tüm env değişkenleri, gerçek sır yok
.github/workflows/ci.yml        tsc + lint + vitest + playwright
.github/workflows/deploy.yml    imaj build → GHCR → VPS pull

prisma/schema.prisma            veri modeli
prisma/seed.ts                  ilk admin + varsayılan kanal

src/lib/db.ts                   PrismaClient singleton
src/lib/result.ts               Result tipi + yardımcılar
src/lib/errors.ts               AppError kodları
src/lib/action.ts               server action sarmalayıcı (auth + zod + policy)
src/lib/slug.ts                 slugify() — senkron, 'use server' dosyasında olamaz
src/lib/auth/config.ts          Auth.js yapılandırması
src/lib/auth/session.ts         requireActor() — oturumdan Actor üretir
src/lib/auth/policy.ts          can(actor, action, resource) — TEK yetki noktası
src/lib/auth/invite-token.ts    token üret + hash + doğrula
src/lib/auth/invite-cookie.ts   davet çerezi sabitleri (döngüsel import'u önler)
src/lib/activity.ts             recordActivity()
src/types/next-auth.d.ts        Session.user.id tip genişletmesi

src/server/channels.ts          kanal server action'ları ('use server')
src/server/channels-query.ts    listVisibleChannels — DÜZ modül, action DEĞİL
src/server/invites.ts           davet server action'ları ('use server')
src/server/invite-service.ts    claim/apply/consume — DÜZ modül, action DEĞİL
src/server/members.ts           üye server action'ları
src/server/profile.ts           profil kurulum action'ı

src/app/layout.tsx              kök layout
src/app/(auth)/login/page.tsx   giriş ekranı
src/app/invite/[token]/page.tsx davet karşılama
src/app/onboarding/page.tsx     profil kurulumu
src/app/(app)/layout.tsx        sidebar'lı uygulama kabuğu
src/app/(app)/page.tsx          ana sayfa (bu planda: aktivite akışı)
src/app/(app)/c/[slug]/page.tsx kanal sayfası (bu planda: iskelet)
src/app/(app)/admin/page.tsx    admin: kanallar, davetler, üyeler

src/components/layout/sidebar.tsx
src/components/ui/*             shadcn/ui bileşenleri
src/components/state/*          Loading / ErrorState / EmptyState

tests/unit/policy.test.ts       yetki matrisi — projenin en kritik testi
tests/unit/invite-token.test.ts
tests/unit/result.test.ts
tests/integration/*.test.ts     gerçek Postgres'e karşı server action testleri
tests/e2e/*.spec.ts             Playwright akışları
```

**Sorumluluk sınırı:** `policy.ts` saf fonksiyondur — veritabanına, oturuma, Next.js'e bağımlı değildir. Sadece `Actor` + `Action` + `Resource` alır, `boolean` döner. Bu sayede yetki matrisi tamamen birim testle kapatılabilir. Veritabanından `Actor` ve `Resource` üretme işi `session.ts` ve çağıran action'ın sorumluluğudur.

---

## Task 1: Proje iskeleti ve CI

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `.env.example`, `.gitignore`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `.github/workflows/ci.yml`
- Test: `tests/unit/smoke.test.ts`

**Interfaces:**
- Consumes: yok (ilk task)
- Produces: `pnpm test` (vitest), `pnpm typecheck` (`tsc --noEmit`), `pnpm lint`, `pnpm build` komutları. Sonraki her task bunlara güvenir.

- [ ] **Step 1: Next.js projesini kur**

```bash
pnpm dlx create-next-app@latest . --typescript --tailwind --eslint --app \
  --src-dir --import-alias "@/*" --use-pnpm --no-turbopack --yes
pnpm add -D vitest @vitejs/plugin-react vite-tsconfig-paths
```

- [ ] **Step 2: `tsconfig.json` içinde strict ayarlarını sıkılaştır**

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "verbatimModuleSyntax": false
  }
}
```

- [ ] **Step 3: `vitest.config.ts` oluştur**

```ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Başarısız olacak smoke testi yaz**

```ts
// tests/unit/smoke.test.ts
import { describe, expect, it } from 'vitest'
import { appName } from '@/lib/constants'

describe('smoke', () => {
  it('uygulama adını verir', () => {
    expect(appName).toBe('MACS')
  })
})
```

- [ ] **Step 5: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/smoke.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/constants"`

- [ ] **Step 6: Minimal implementasyon**

```ts
// src/lib/constants.ts
export const appName = 'MACS'
```

- [ ] **Step 7: Testi çalıştır, geçtiğini gör**

Run: `pnpm vitest run tests/unit/smoke.test.ts`
Expected: PASS (1 test)

- [ ] **Step 8: `package.json` script'lerini ekle**

```jsonc
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 9: CI workflow'u ekle**

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: macs_test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/macs_test
      AUTH_SECRET: ci-only-not-a-real-secret
      AUTH_URL: http://localhost:3100
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
```

- [ ] **Step 10: `.env.example` oluştur**

```bash
DATABASE_URL=postgresql://macs:macs@localhost:5432/macs
AUTH_SECRET=
AUTH_URL=http://localhost:3100
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold next.js app with strict ts, vitest and ci"
```

---

## Task 2: Docker geliştirme ortamı ve veritabanı bağlantısı

**Files:**
- Create: `compose.dev.yml`, `Dockerfile`, `.dockerignore`
- Create: `src/lib/db.ts`
- Create: `prisma/schema.prisma` (yalnızca datasource + generator)
- Test: `tests/integration/db.test.ts`

**Interfaces:**
- Consumes: Task 1'in `pnpm test` altyapısı
- Produces: `import { db } from '@/lib/db'` — tüm sunucu kodunun kullandığı `PrismaClient` singleton'ı. `pnpm db:migrate`, `pnpm db:reset` script'leri.

- [ ] **Step 1: `compose.dev.yml` yaz**

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: macs
      POSTGRES_PASSWORD: macs
      POSTGRES_DB: macs
    ports: ['5432:5432']
    volumes: ['macs_pgdata:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U macs']
      interval: 5s
      retries: 10

volumes:
  macs_pgdata:
```

- [ ] **Step 2: Veritabanını ayağa kaldır**

Run: `docker compose -f compose.dev.yml up -d && docker compose -f compose.dev.yml ps`
Expected: `db` servisi `healthy`

- [ ] **Step 3: Prisma'yı kur ve datasource tanımla**

```bash
pnpm add @prisma/client && pnpm add -D prisma
```

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

- [ ] **Step 4: Başarısız olacak testi yaz**

```ts
// tests/integration/db.test.ts
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'

describe('db', () => {
  it('veritabanına bağlanır', async () => {
    const rows = await db.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`
    expect(rows[0]?.ok).toBe(1)
  })
})
```

- [ ] **Step 5: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/integration/db.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/db"`

- [ ] **Step 6: `src/lib/db.ts` yaz**

```ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
```

- [ ] **Step 7: Prisma client'ı üret ve testi çalıştır**

Run: `pnpm prisma generate && DATABASE_URL=postgresql://macs:macs@localhost:5432/macs pnpm vitest run tests/integration/db.test.ts`
Expected: PASS

- [ ] **Step 8: Script'leri ve `Dockerfile`'ı ekle**

```jsonc
{
  "scripts": {
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:reset": "prisma migrate reset --force",
    "db:studio": "prisma studio"
  }
}
```

```dockerfile
# Dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

# Migration hedefi: prisma CLI'ın çalışması için tam node_modules gerekir.
# Ayrı imaj olarak build edilip push edilir, deploy'da bir kez çalışıp çıkar.
FROM base AS migrate
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY package.json ./
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

FROM base AS run
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
EXPOSE 3000
CMD ["node", "server.js"]
```

`docker build --target run -t macs-web .` ve `docker build --target migrate -t macs-migrate .` iki ayrı imaj üretir. Task 14'teki deploy workflow ikisini de push eder.

> **Migration burada çalışmaz.** `prisma` CLI ayrı bir devDependency paketidir; Next'in standalone tracing'i onu imaja taşımaz, çünkü uygulama kodu import etmez. `node_modules/.bin/prisma`'yı CMD'ye koymak container'ı açılmaz hale getirir. Migration'ı Task 14'teki kısa ömürlü `migrate` servisi çalıştırır.

`next.config.ts` içine `output: 'standalone'` eklenir.

- [ ] **Step 9: Testi tekrar çalıştır ve commit**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

```bash
git add -A
git commit -m "feat: add docker dev stack and prisma client singleton"
```

---

## Task 3: Veri modeli — kimlik ve organizasyon

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/*` (üretilir)
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Consumes: `db` (Task 2)
- Produces: Prisma modelleri `User`, `Account`, `Session`, `VerificationToken`, `Channel`, `ChannelMember`, `Invite`, `Activity` ve enum'ları `GlobalRole`, `ChannelRole`, `ChannelVisibility`. Sonraki tüm task'lar bu isimlere göre yazılır.

- [ ] **Step 1: Başarısız olacak testi yaz**

```ts
// tests/integration/schema.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'

beforeEach(async () => {
  await db.activity.deleteMany()
  await db.channelMember.deleteMany()
  await db.invite.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
})

describe('şema', () => {
  it('kullanıcıyı kanala üye yapar ve rolünü saklar', async () => {
    const user = await db.user.create({ data: { name: 'Efe' } })
    const channel = await db.channel.create({
      data: { name: 'Sponsorluk', slug: 'sponsorluk', createdById: user.id },
    })
    await db.channelMember.create({
      data: { userId: user.id, channelId: channel.id, channelRole: 'LEAD' },
    })

    const loaded = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { memberships: true },
    })

    expect(loaded.globalRole).toBe('MEMBER')
    expect(loaded.isActive).toBe(true)
    expect(loaded.memberships[0]?.channelRole).toBe('LEAD')
    expect(channel.visibility).toBe('OPEN')
  })

  it('aynı kullanıcıyı aynı kanala iki kez ekleyemez', async () => {
    const user = await db.user.create({ data: { name: 'Efe' } })
    const channel = await db.channel.create({
      data: { name: 'Medya', slug: 'medya', createdById: user.id },
    })
    await db.channelMember.create({ data: { userId: user.id, channelId: channel.id } })

    await expect(
      db.channelMember.create({ data: { userId: user.id, channelId: channel.id } }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/integration/schema.test.ts`
Expected: FAIL — `db.channel` tanımlı değil

- [ ] **Step 3: Şemayı yaz**

```prisma
enum GlobalRole {
  ADMIN
  MEMBER
}

enum ChannelRole {
  LEAD
  MEMBER
}

enum ChannelVisibility {
  OPEN
  PRIVATE
}

model User {
  id          String   @id @default(cuid())
  name        String
  email       String?  @unique
  avatarUrl   String?
  title       String?
  globalRole  GlobalRole @default(MEMBER)
  isActive    Boolean  @default(true)
  onboardedAt DateTime?
  joinedAt    DateTime @default(now())

  accounts       Account[]
  sessions       Session[]
  memberships    ChannelMember[]
  createdChannels Channel[]      @relation("ChannelCreatedBy")
  createdInvites Invite[]        @relation("InviteCreatedBy")
  usedInvites    Invite[]        @relation("InviteUsedBy")
  activities     Activity[]

  @@index([isActive])
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

model Channel {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  icon        String?
  color       String?
  description String?
  visibility  ChannelVisibility @default(OPEN)
  createdById String
  createdAt   DateTime @default(now())
  archivedAt  DateTime?

  createdBy User            @relation("ChannelCreatedBy", fields: [createdById], references: [id])
  members   ChannelMember[]
  invites   Invite[]

  @@index([archivedAt])
}

model ChannelMember {
  id          String      @id @default(cuid())
  channelId   String
  userId      String
  channelRole ChannelRole @default(MEMBER)
  joinedAt    DateTime    @default(now())

  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([channelId, userId])
  @@index([userId])
}

model Invite {
  id          String      @id @default(cuid())
  tokenHash   String      @unique
  globalRole  GlobalRole  @default(MEMBER)
  channelId   String?
  channelRole ChannelRole @default(MEMBER)
  expiresAt   DateTime
  // Null = sistem daveti. Kurulumdaki ilk admin davetinin üretecek bir
  // kullanıcısı yoktur; zorunlu tutmak seed'i hayalet bir kullanıcı
  // uydurmaya zorlar ve o kullanıcıya kimse giriş yapamaz.
  createdById String?
  createdAt   DateTime    @default(now())
  usedByUserId String?
  usedAt      DateTime?
  revokedAt   DateTime?

  channel    Channel? @relation(fields: [channelId], references: [id], onDelete: SetNull)
  createdBy  User?    @relation("InviteCreatedBy", fields: [createdById], references: [id])
  usedBy     User?    @relation("InviteUsedBy", fields: [usedByUserId], references: [id])

  @@index([expiresAt])
}

model Activity {
  id         String   @id @default(cuid())
  actorId    String
  verb       String
  entityType String
  entityId   String
  // Akışın kapsamlanabilmesi için: kaydın ait olduğu kanal. Null ise
  // kulüp geneli (üye katıldı, rol değişti). Bu alan olmadan ana sayfadaki
  // akış PRIVATE kanal hareketlerini herkese gösterir.
  channelId  String?
  meta       Json?
  createdAt  DateTime @default(now())

  actor User @relation(fields: [actorId], references: [id], onDelete: Cascade)

  @@index([createdAt])
  @@index([entityType, entityId])
}
```

- [ ] **Step 4: Migration üret ve testi çalıştır**

Run: `pnpm db:migrate --name init_identity_and_channels && pnpm vitest run tests/integration/schema.test.ts`
Expected: PASS (2 test)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add identity, channel and activity data model"
```

---

## Task 4: `Result` tipi ve hata sözlüğü

**Files:**
- Create: `src/lib/result.ts`, `src/lib/errors.ts`
- Test: `tests/unit/result.test.ts`

**Interfaces:**
- Consumes: yok
- Produces:
  - `type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }`
  - `type AppError = { code: ErrorCode; message: string; fields?: Record<string, string> }`
  - `ok<T>(data: T): Result<T>`
  - `fail(code: ErrorCode, fields?: Record<string, string>): Result<never>`
  - `ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'CONFLICT' | 'INTERNAL'`

- [ ] **Step 1: Başarısız olacak testi yaz**

```ts
// tests/unit/result.test.ts
import { describe, expect, it } from 'vitest'
import { fail, ok } from '@/lib/result'

describe('Result', () => {
  it('başarılı sonucu sarmalar', () => {
    expect(ok({ id: '1' })).toEqual({ ok: true, data: { id: '1' } })
  })

  it('hata koduna Türkçe mesaj eşler', () => {
    const r = fail('FORBIDDEN')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error.code).toBe('FORBIDDEN')
    expect(r.error.message).toBe('Bu işlem için yetkin yok.')
  })

  it('alan bazlı doğrulama hatalarını taşır', () => {
    const r = fail('VALIDATION', { name: 'Ad zorunlu.' })
    if (r.ok) throw new Error('unreachable')
    expect(r.error.fields).toEqual({ name: 'Ad zorunlu.' })
  })
})
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/result.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/result"`

- [ ] **Step 3: Implementasyon**

```ts
// src/lib/errors.ts
export const errorMessages = {
  UNAUTHENTICATED: 'Giriş yapman gerekiyor.',
  FORBIDDEN: 'Bu işlem için yetkin yok.',
  NOT_FOUND: 'Kayıt bulunamadı.',
  VALIDATION: 'Girdiğin bilgilerde hata var.',
  CONFLICT: 'Bu işlem mevcut durumla çakışıyor.',
  INTERNAL: 'Beklenmeyen bir hata oldu. Tekrar dene.',
} as const

export type ErrorCode = keyof typeof errorMessages

export type AppError = {
  code: ErrorCode
  message: string
  fields?: Record<string, string>
}
```

```ts
// src/lib/result.ts
import { type AppError, type ErrorCode, errorMessages } from '@/lib/errors'

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail(code: ErrorCode, fields?: Record<string, string>): Result<never> {
  const error: AppError = { code, message: errorMessages[code] }
  if (fields) error.fields = fields
  return { ok: false, error }
}
```

- [ ] **Step 4: Testi çalıştır**

Run: `pnpm vitest run tests/unit/result.test.ts`
Expected: PASS (3 test)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Result type and error dictionary"
```

---

## Task 5: Yetki motoru — `policy.ts`

Projenin en kritik dosyası. Saf fonksiyon: veritabanı, oturum, Next.js bağımlılığı yok.

**Files:**
- Create: `src/lib/auth/policy.ts`
- Test: `tests/unit/policy.test.ts`

**Interfaces:**
- Consumes: yok (saf)
- Produces:
  - `type Actor = { id: string; globalRole: 'ADMIN' | 'MEMBER'; isActive: boolean; memberships: { channelId: string; channelRole: 'LEAD' | 'MEMBER' }[] }`
  - `type Action` — birleşim tipi, aşağıda tam listesi
  - `type Resource` — ayrık birleşim (`kind` alanıyla)
  - `can(actor: Actor, action: Action, resource: Resource): boolean`

  Sonraki planlar bu dosyaya **yeni `Action` ve `Resource` varyantı ekleyerek** genişletir; mevcut kurallar değiştirilmez.

- [ ] **Step 1: Yetki matrisi testini yaz (başarısız olacak)**

```ts
// tests/unit/policy.test.ts
import { describe, expect, it } from 'vitest'
import { type Actor, type Resource, can } from '@/lib/auth/policy'

const admin: Actor = {
  id: 'admin', globalRole: 'ADMIN', isActive: true,
  memberships: [],
}
const lead: Actor = {
  id: 'lead', globalRole: 'MEMBER', isActive: true,
  memberships: [{ channelId: 'c1', channelRole: 'LEAD' }],
}
const member: Actor = {
  id: 'member', globalRole: 'MEMBER', isActive: true,
  memberships: [{ channelId: 'c1', channelRole: 'MEMBER' }],
}
const outsider: Actor = {
  id: 'outsider', globalRole: 'MEMBER', isActive: true,
  memberships: [{ channelId: 'c2', channelRole: 'MEMBER' }],
}
const inactive: Actor = { ...member, id: 'inactive', isActive: false }

const openChannel: Resource = {
  kind: 'channel', id: 'c1', visibility: 'OPEN', archivedAt: null,
}
const privateChannel: Resource = {
  kind: 'channel', id: 'c1', visibility: 'PRIVATE', archivedAt: null,
}
const openContent: Resource = {
  kind: 'content', channelId: 'c1', channelVisibility: 'OPEN',
  ownerId: 'member', assigneeIds: [],
}
const privateContent: Resource = {
  kind: 'content', channelId: 'c1', channelVisibility: 'PRIVATE',
  ownerId: 'member', assigneeIds: [],
}

describe('can() — pasif kullanıcı', () => {
  it('pasif kullanıcı hiçbir şey yapamaz', () => {
    expect(can(inactive, 'channel:read', openChannel)).toBe(false)
    expect(can(inactive, 'content:read', openContent)).toBe(false)
    expect(can({ ...admin, isActive: false }, 'invite:create', { kind: 'invite' })).toBe(false)
  })
})

describe('can() — kanal', () => {
  it('OPEN kanalı herkes okur, PRIVATE kanalı sadece üyesi okur', () => {
    expect(can(outsider, 'channel:read', openChannel)).toBe(true)
    expect(can(outsider, 'channel:read', privateChannel)).toBe(false)
    expect(can(member, 'channel:read', privateChannel)).toBe(true)
    expect(can(admin, 'channel:read', privateChannel)).toBe(true)
  })

  it('kanal açmayı LEAD ve admin yapabilir, düz üye yapamaz', () => {
    expect(can(lead, 'channel:create', { kind: 'channel:new' })).toBe(true)
    expect(can(admin, 'channel:create', { kind: 'channel:new' })).toBe(true)
    expect(can(member, 'channel:create', { kind: 'channel:new' })).toBe(false)
  })

  it('kanal ayarlarını ve üyelerini LEAD ile admin yönetir', () => {
    expect(can(lead, 'channel:update', openChannel)).toBe(true)
    expect(can(lead, 'channel:manageMembers', openChannel)).toBe(true)
    expect(can(member, 'channel:manageMembers', openChannel)).toBe(false)
    expect(can(admin, 'channel:manageMembers', openChannel)).toBe(true)
  })

  it('kanalı yalnızca admin arşivler', () => {
    expect(can(lead, 'channel:archive', openChannel)).toBe(false)
    expect(can(admin, 'channel:archive', openChannel)).toBe(true)
  })

  it('arşivlenmiş kanalda yazma işlemi yapılamaz', () => {
    const archived: Resource = { ...openChannel, archivedAt: new Date() }
    expect(can(lead, 'channel:update', archived)).toBe(false)
    expect(can(admin, 'channel:update', archived)).toBe(false)
    expect(can(member, 'channel:read', archived)).toBe(true)
  })
})

describe('can() — kanal içeriği', () => {
  it('OPEN kanal içeriğini tüm kulüp okur', () => {
    expect(can(outsider, 'content:read', openContent)).toBe(true)
  })

  it('PRIVATE kanal içeriğini yalnızca üyeler ve admin okur', () => {
    expect(can(outsider, 'content:read', privateContent)).toBe(false)
    expect(can(member, 'content:read', privateContent)).toBe(true)
    expect(can(admin, 'content:read', privateContent)).toBe(true)
  })

  it('yazma yetkisi kanal üyeliğine bağlıdır, okuma yetmez', () => {
    expect(can(outsider, 'content:write', openContent)).toBe(false)
    expect(can(member, 'content:write', openContent)).toBe(true)
  })

  it('atanan kişi üye olmasa da yazabilir', () => {
    const assigned: Resource = {
      kind: 'content', channelId: 'c1', channelVisibility: 'OPEN',
      ownerId: 'member', assigneeIds: ['outsider'],
    }
    expect(can(outsider, 'content:write', assigned)).toBe(true)
  })

  it('silmeyi sahip, kanal LEAD ve admin yapar', () => {
    expect(can(member, 'content:delete', openContent)).toBe(true)
    expect(can(lead, 'content:delete', openContent)).toBe(true)
    expect(can(admin, 'content:delete', openContent)).toBe(true)
    expect(can(outsider, 'content:delete', openContent)).toBe(false)
  })
})

describe('can() — davet ve üye yönetimi', () => {
  it('daveti yalnızca admin üretir ve iptal eder', () => {
    expect(can(admin, 'invite:create', { kind: 'invite' })).toBe(true)
    expect(can(lead, 'invite:create', { kind: 'invite' })).toBe(false)
    expect(can(admin, 'invite:revoke', { kind: 'invite' })).toBe(true)
    expect(can(lead, 'invite:revoke', { kind: 'invite' })).toBe(false)
  })

  it('üye listesini herkes görür, rol değiştirmeyi yalnızca admin yapar', () => {
    expect(can(member, 'member:list', { kind: 'member', id: 'x' })).toBe(true)
    expect(can(member, 'member:updateRole', { kind: 'member', id: 'x' })).toBe(false)
    expect(can(admin, 'member:updateRole', { kind: 'member', id: 'x' })).toBe(true)
  })

  it('admin kendini pasife alamaz', () => {
    expect(can(admin, 'member:deactivate', { kind: 'member', id: 'other' })).toBe(true)
    expect(can(admin, 'member:deactivate', { kind: 'member', id: 'admin' })).toBe(false)
  })
})
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/policy.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/auth/policy"`

- [ ] **Step 3: Implementasyon**

```ts
// src/lib/auth/policy.ts
export type GlobalRole = 'ADMIN' | 'MEMBER'
export type ChannelRole = 'LEAD' | 'MEMBER'
export type Visibility = 'OPEN' | 'PRIVATE'

export type Actor = {
  id: string
  globalRole: GlobalRole
  isActive: boolean
  memberships: { channelId: string; channelRole: ChannelRole }[]
}

export type Action =
  | 'channel:create'
  | 'channel:read'
  | 'channel:update'
  | 'channel:archive'
  | 'channel:manageMembers'
  | 'content:read'
  | 'content:write'
  | 'content:delete'
  | 'invite:create'
  | 'invite:revoke'
  | 'invite:list'
  | 'member:list'
  | 'member:updateRole'
  | 'member:deactivate'

export type Resource =
  | { kind: 'channel:new' }
  | { kind: 'channel'; id: string; visibility: Visibility; archivedAt: Date | null }
  | {
      kind: 'content'
      channelId: string
      channelVisibility: Visibility
      channelArchivedAt: Date | null
      ownerId?: string | null
      assigneeIds?: string[]
    }
  | { kind: 'invite' }
  | { kind: 'member'; id: string }

function membership(actor: Actor, channelId: string) {
  return actor.memberships.find((m) => m.channelId === channelId)
}

function isAdmin(actor: Actor) {
  return actor.globalRole === 'ADMIN'
}

export function can(actor: Actor, action: Action, resource: Resource): boolean {
  // Pasif kullanıcı hiçbir yetkiye sahip değildir. Tek ve mutlak kural.
  if (!actor.isActive) return false

  switch (action) {
    case 'channel:create':
      return resource.kind === 'channel:new' &&
        (isAdmin(actor) || actor.memberships.some((m) => m.channelRole === 'LEAD'))

    case 'channel:read':
      if (resource.kind !== 'channel') return false
      return resource.visibility === 'OPEN' || isAdmin(actor) || !!membership(actor, resource.id)

    case 'channel:update':
    case 'channel:manageMembers': {
      if (resource.kind !== 'channel' || resource.archivedAt) return false
      return isAdmin(actor) || membership(actor, resource.id)?.channelRole === 'LEAD'
    }

    case 'channel:archive':
      return resource.kind === 'channel' && isAdmin(actor)

    case 'content:read': {
      if (resource.kind !== 'content') return false
      return resource.channelVisibility === 'OPEN' ||
        isAdmin(actor) ||
        !!membership(actor, resource.channelId)
    }

    case 'content:write': {
      if (resource.kind !== 'content') return false
      // Arşivlenmiş kanal salt-okunur: içeriği de kapsar.
      if (resource.channelArchivedAt) return false
      if (isAdmin(actor)) return true
      if (membership(actor, resource.channelId)) return true
      // Atama, PRIVATE kanalda üyeliğin yerine geçmez. Geçseydi kişi
      // yazabildiği içeriği okuyamazdı; o asimetri sayfa kodunda
      // "okuma kontrolünü atla" refleksi doğurur.
      if (resource.channelVisibility !== 'OPEN') return false
      return resource.assigneeIds?.includes(actor.id) ?? false
    }

    case 'content:delete': {
      if (resource.kind !== 'content') return false
      if (resource.channelArchivedAt) return false
      if (isAdmin(actor)) return true
      if (resource.ownerId === actor.id) return true
      return membership(actor, resource.channelId)?.channelRole === 'LEAD'
    }

    case 'invite:create':
    case 'invite:revoke':
    case 'invite:list':
      return resource.kind === 'invite' && isAdmin(actor)

    case 'member:list':
      return resource.kind === 'member'

    case 'member:updateRole':
      return resource.kind === 'member' && isAdmin(actor)

    case 'member:deactivate':
      // Admin kendini pasife alamaz: sistemde admin kalmama riski.
      return resource.kind === 'member' && isAdmin(actor) && resource.id !== actor.id

    default: {
      // Derleme zamanı ağı: yeni bir Action kuralsız eklenirse burası hata verir.
      const exhaustive: never = action
      void exhaustive
      // Çalışma zamanı ağı: tipsiz sınırdan (form verisi, JSON gövdesi) gelen
      // bilinmeyen bir action `undefined` değil `false` döner.
      return false
    }
  }
}
```

- [ ] **Step 4: Testi çalıştır**

Run: `pnpm vitest run tests/unit/policy.test.ts`
Expected: PASS (14 test)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add central authorization policy with full test matrix"
```

---

## Task 6: Davet token'ı üretimi ve doğrulaması

**Files:**
- Create: `src/lib/auth/invite-token.ts`
- Test: `tests/unit/invite-token.test.ts`

**Interfaces:**
- Consumes: yok
- Produces:
  - `createInviteToken(): { token: string; tokenHash: string }`
  - `hashInviteToken(token: string): string`

- [ ] **Step 1: Başarısız olacak testi yaz**

```ts
// tests/unit/invite-token.test.ts
import { describe, expect, it } from 'vitest'
import { createInviteToken, hashInviteToken } from '@/lib/auth/invite-token'

describe('davet token', () => {
  it('URL-güvenli ve yeterince uzun token üretir', () => {
    const { token } = createInviteToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('her çağrıda farklı token üretir', () => {
    expect(createInviteToken().token).not.toBe(createInviteToken().token)
  })

  it("hash deterministiktir ve ham token'ı içermez", () => {
    const { token, tokenHash } = createInviteToken()
    expect(hashInviteToken(token)).toBe(tokenHash)
    expect(tokenHash).not.toContain(token)
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/)
  })
})
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/invite-token.test.ts`
Expected: FAIL — modül bulunamadı

- [ ] **Step 3: Implementasyon**

```ts
// src/lib/auth/invite-token.ts
import { createHash, randomBytes } from 'node:crypto'

/**
 * Token 32 byte kriptografik rastgeledir; base64url ile 43 karaktere düşer.
 * Yüksek entropili olduğu için SHA-256 yeterlidir — bcrypt/argon2 gerekmez,
 * onlar düşük entropili parolalar içindir.
 */
export function createInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInviteToken(token) }
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
```

- [ ] **Step 4: Testi çalıştır**

Run: `pnpm vitest run tests/unit/invite-token.test.ts`
Expected: PASS (3 test)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add invite token generation and hashing"
```

---

## Task 7: Auth.js kurulumu ve `requireActor()`

**Files:**
- Create: `src/lib/auth/config.ts`, `src/lib/auth/session.ts`, `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/app/(auth)/login/page.tsx`, `src/types/next-auth.d.ts`
- Test: `tests/integration/session.test.ts`

**Interfaces:**
- Consumes: `db` (Task 2), `Actor` (Task 5)
- Produces:
  - `auth()`, `signIn()`, `signOut()` — Auth.js dışa aktarımları
  - `getActor(): Promise<Actor | null>` — oturumdan `Actor` üretir
  - `requireActor(): Promise<Actor>` — oturum yoksa `/login`'e yönlendirir
  - `toActor(user): Actor` — saf dönüştürücü (test edilebilir)

- [ ] **Step 1: Auth.js paketlerini kur**

```bash
pnpm add next-auth@beta @auth/prisma-adapter
```

- [ ] **Step 2: Başarısız olacak testi yaz**

```ts
// tests/integration/session.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { toActor } from '@/lib/auth/session'

beforeEach(async () => {
  await db.channelMember.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
})

describe('toActor', () => {
  it('kullanıcı ve üyeliklerinden Actor üretir', async () => {
    const user = await db.user.create({
      data: { name: 'Efe', globalRole: 'ADMIN' },
    })
    const channel = await db.channel.create({
      data: { name: 'Proje', slug: 'proje', createdById: user.id },
    })
    await db.channelMember.create({
      data: { userId: user.id, channelId: channel.id, channelRole: 'LEAD' },
    })

    const loaded = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { memberships: true },
    })

    expect(toActor(loaded)).toEqual({
      id: user.id,
      globalRole: 'ADMIN',
      isActive: true,
      memberships: [{ channelId: channel.id, channelRole: 'LEAD' }],
    })
  })
})
```

- [ ] **Step 3: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/integration/session.test.ts`
Expected: FAIL — `toActor` bulunamadı

- [ ] **Step 4: Auth yapılandırmasını yaz**

```ts
// src/lib/auth/config.ts
import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { db } from '@/lib/db'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: 'database' },
  // Hata sayfası da /login'e döner: Auth.js'in kendi hata ekranı İngilizcedir.
  pages: { signIn: '/login', error: '/login' },
  // Google, AUTH_GOOGLE_ID ve AUTH_GOOGLE_SECRET'ı ortamdan kendisi okur.
  // Değerleri elle geçirmek strict TS'te `string | undefined` hatası verir.
  providers: [Google],
  callbacks: {
    /**
     * Davet olmadan kimse giremez. Yeni kullanıcı yalnızca
     * /invite/[token] akışının kurduğu çerezle oluşturulabilir (Task 9).
     */
    async signIn({ user }) {
      if (!user.email) return false
      const existing = await db.user.findUnique({ where: { email: user.email } })
      if (existing) return existing.isActive
      return true // yeni kullanıcı kontrolü davet akışında yapılır
    },
    /**
     * Oturum yanıtı daraltılır. Ham adaptör satırı `sessionToken` içerir ve
     * `session` callback'i ne döndürürse /api/auth/session onu JSON olarak
     * yayınlar — token oradan sızarsa httpOnly çerezin anlamı kalmaz.
     */
    async session({ session, user }) {
      return {
        expires: session.expires,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
      }
    },
  },
})
```

```ts
// src/app/api/auth/[...nextauth]/route.ts
import { handlers } from '@/lib/auth/config'
export const { GET, POST } = handlers
```

- [ ] **Step 5: `session.ts` yaz**

```ts
// src/lib/auth/session.ts
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/config'
import { db } from '@/lib/db'
import type { Actor } from '@/lib/auth/policy'

type UserWithMemberships = {
  id: string
  globalRole: 'ADMIN' | 'MEMBER'
  isActive: boolean
  memberships: { channelId: string; channelRole: 'LEAD' | 'MEMBER' }[]
}

export function toActor(user: UserWithMemberships): Actor {
  return {
    id: user.id,
    globalRole: user.globalRole,
    isActive: user.isActive,
    memberships: user.memberships.map((m) => ({
      channelId: m.channelId,
      channelRole: m.channelRole,
    })),
  }
}

export async function getActor(): Promise<Actor | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { memberships: true },
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

- [ ] **Step 6: Giriş ekranını yaz**

```tsx
// src/app/(auth)/login/page.tsx
import { signIn } from '@/lib/auth/config'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold">MACS</h1>
        <p className="text-sm text-muted-foreground">
          Kulüp çalışma alanına girmek için davet linkine ihtiyacın var.
        </p>
        <form
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/' })
          }}
        >
          <Button type="submit" className="w-full">
            Google ile devam et
          </Button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 7: `session.user.id` için tip genişletmesi yaz**

`session` callback'i `session.user.id` atar; varsayılan Auth.js tipinde bu alan yoktur ve `pnpm typecheck` hata verir.

```ts
// src/types/next-auth.d.ts
import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}
```

- [ ] **Step 8: shadcn/ui'yi başlat ve Button'ı ekle**

```bash
pnpm dlx shadcn@latest init -d
pnpm dlx shadcn@latest add button input label card dialog select avatar badge dropdown-menu sonner skeleton
```

- [ ] **Step 9: Testi çalıştır**

Run: `pnpm vitest run tests/integration/session.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add google auth with db sessions and actor resolution"
```

---

## Task 8: Server action sarmalayıcı

Her action'da tekrar eden üç adımı (oturum → doğrulama → yetki) tek yerde toplar. Bu sarmalayıcı kullanılmadığında yetki kontrolünü unutmak mümkün olur; bu yüzden tüm action'lar bunun üzerinden yazılır.

**Files:**
- Create: `src/lib/action.ts`
- Test: `tests/unit/action.test.ts`

**Interfaces:**
- Consumes: `Result`/`ok`/`fail` (Task 4), `can`/`Actor`/`Action`/`Resource` (Task 5)
- Produces: `defineAction({ input, authorize, handler })` → `(raw: unknown) => Promise<Result<T>>`

- [ ] **Step 1: Başarısız olacak testi yaz**

```ts
// tests/unit/action.test.ts
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineAction } from '@/lib/action'
import type { Actor } from '@/lib/auth/policy'

const actor: Actor = { id: 'u1', globalRole: 'MEMBER', isActive: true, memberships: [] }
const schema = z.object({ name: z.string().min(1, 'Ad zorunlu.') })

type Overrides = {
  getActor?: () => Promise<Actor | null>
  authorize?: () => Promise<{ allowed: true } | { allowed: false }>
  handler?: (ctx: { input: { name: string } }) => Promise<{ name: string }>
}

function build(overrides: Overrides = {}) {
  return defineAction({
    input: schema,
    getActor: overrides.getActor ?? (async () => actor),
    authorize: overrides.authorize ?? (async () => ({ allowed: true as const })),
    handler: overrides.handler ?? (async ({ input }) => ({ name: input.name })),
  })
}

describe('defineAction', () => {
  it('geçerli girdiyle handler sonucunu döner', async () => {
    const action = build()
    await expect(action({ name: 'Efe' })).resolves.toEqual({
      ok: true, data: { name: 'Efe' },
    })
  })

  it('geçersiz girdide alan bazlı VALIDATION hatası döner', async () => {
    const action = build()
    const r = await action({ name: '' })
    expect(r).toEqual({
      ok: false,
      error: { code: 'VALIDATION', message: 'Girdiğin bilgilerde hata var.', fields: { name: 'Ad zorunlu.' } },
    })
  })

  it('oturum yoksa UNAUTHENTICATED döner ve handler çalışmaz', async () => {
    const handler = vi.fn()
    const action = build({ getActor: async () => null, handler })
    const r = await action({ name: 'Efe' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('UNAUTHENTICATED')
    expect(handler).not.toHaveBeenCalled()
  })

  it('yetki reddedilirse FORBIDDEN döner ve handler çalışmaz', async () => {
    const handler = vi.fn()
    const action = build({ authorize: async () => ({ allowed: false as const }), handler })
    const r = await action({ name: 'Efe' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
    expect(handler).not.toHaveBeenCalled()
  })

  it('handler beklenmeyen hata fırlatırsa INTERNAL döner', async () => {
    const action = build({ handler: async () => { throw new Error('boom') } })
    const r = await action({ name: 'Efe' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INTERNAL')
  })
})
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/action.test.ts`
Expected: FAIL — modül bulunamadı

- [ ] **Step 3: Implementasyon**

```ts
// src/lib/action.ts
import { unstable_rethrow } from 'next/navigation'
import type { z } from 'zod'
import { fail, ok, type Result } from '@/lib/result'
import type { Actor } from '@/lib/auth/policy'
import type { ErrorCode } from '@/lib/errors'

type AuthorizeOutcome =
  | { allowed: true }
  | { allowed: false; code?: Extract<ErrorCode, 'FORBIDDEN' | 'NOT_FOUND'> }

type Definition<TSchema extends z.ZodTypeAny, TOut> = {
  input: TSchema
  getActor: () => Promise<Actor | null>
  authorize: (ctx: { actor: Actor; input: z.infer<TSchema> }) => Promise<AuthorizeOutcome>
  handler: (ctx: { actor: Actor; input: z.infer<TSchema> }) => Promise<TOut>
}

/**
 * Handler'ın kod taşıyan hata bildirmesinin tek yolu. `throw actionError(...)`
 * sarmalayıcıda yakalanır ve aynı kodla `Result` hatasına çevrilir.
 */
export class ActionError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly fields?: Record<string, string>,
  ) {
    super(code)
    this.name = 'ActionError'
  }
}

export function actionError(code: ErrorCode, fields?: Record<string, string>): ActionError {
  return new ActionError(code, fields)
}

export function defineAction<TSchema extends z.ZodTypeAny, TOut>(
  def: Definition<TSchema, TOut>,
): (raw: unknown) => Promise<Result<TOut>> {
  return async (raw: unknown) => {
    // Tüm akış sarmalanır: getActor ve authorize da veritabanına gider ve
    // fırlatabilir. Exception bu sınırı hiçbir koşulda geçmemeli.
    try {
      const parsed = def.input.safeParse(raw)
      if (!parsed.success) {
        const fields: Record<string, string> = {}
        for (const issue of parsed.error.issues) {
          const key = issue.path.join('.') || '_'
          if (!fields[key]) fields[key] = issue.message
        }
        return fail('VALIDATION', fields)
      }

      const actor = await def.getActor()
      if (!actor) return fail('UNAUTHENTICATED')

      // Yetki kontrolü handler'dan ÖNCE. Bu sıra değiştirilemez.
      const decision = await def.authorize({ actor, input: parsed.data })
      if (!decision.allowed) return fail(decision.code ?? 'FORBIDDEN')

      return ok(await def.handler({ actor, input: parsed.data }))
    } catch (error) {
      // Next'in redirect() ve notFound() akışı throw ile çalışır; yutulursa
      // yönlendirme sessizce INTERNAL'a döner.
      unstable_rethrow(error)
      if (error instanceof ActionError) return fail(error.code, error.fields)
      console.error('[action] unhandled error', error)
      return fail('INTERNAL')
    }
  }
}
```

- [ ] **Step 4: Testi çalıştır**

Run: `pnpm vitest run tests/unit/action.test.ts`
Expected: PASS (5 test)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add server action wrapper enforcing auth before handler"
```

---

## Task 9: Davet üretme, iptal ve kullanma akışı

**Files:**
- Create: `src/lib/activity.ts`, `src/lib/auth/invite-cookie.ts`
- Create: `src/server/invites.ts`
- Create: `src/app/invite/[token]/page.tsx`
- Modify: `src/lib/auth/config.ts` (davet çerezini `signIn` callback'inde doğrula)
- Test: `tests/integration/invites.test.ts`

**Interfaces:**
- Consumes: `defineAction` (Task 8), `createInviteToken`/`hashInviteToken` (Task 6), `getActor` (Task 7)
- Produces:
  - `recordActivity(tx, { actorId, verb, entityType, entityId, meta? }): Promise<void>`
  - `createInvite({ globalRole, channelId?, channelRole? })` → `Result<{ url: string }>`
  - `revokeInvite({ inviteId })` → `Result<{ id: string }>`
  - `consumeInvite(token, userId)` → `Result<{ channelId: string | null }>` (sunucu içi yardımcı, action değil)

- [ ] **Step 1: Başarısız olacak testi yaz**

```ts
// tests/integration/invites.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { consumeInvite } from '@/server/invites'
import { createInviteToken } from '@/lib/auth/invite-token'

let adminId: string
let channelId: string

beforeEach(async () => {
  await db.activity.deleteMany()
  await db.invite.deleteMany()
  await db.channelMember.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()

  const admin = await db.user.create({ data: { name: 'Admin', globalRole: 'ADMIN' } })
  adminId = admin.id
  const channel = await db.channel.create({
    data: { name: 'Proje', slug: 'proje', createdById: admin.id },
  })
  channelId = channel.id
})

async function seedInvite(overrides: Partial<{ expiresAt: Date; revokedAt: Date }> = {}) {
  const { token, tokenHash } = createInviteToken()
  await db.invite.create({
    data: {
      tokenHash,
      channelId,
      channelRole: 'MEMBER',
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * 864e5),
      revokedAt: overrides.revokedAt ?? null,
      createdById: adminId,
    },
  })
  return token
}

describe('consumeInvite', () => {
  it('geçerli daveti kullanır, kanala üye yapar ve daveti işaretler', async () => {
    const token = await seedInvite()
    const user = await db.user.create({ data: { name: 'Yeni', email: 'y@x.com' } })

    const r = await consumeInvite(token, user.id)

    expect(r).toEqual({ ok: true, data: { channelId } })
    const membership = await db.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: user.id } },
    })
    expect(membership?.channelRole).toBe('MEMBER')
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.usedByUserId).toBe(user.id)
    expect(invite.usedAt).not.toBeNull()
  })

  it('aynı davet ikinci kez kullanılamaz', async () => {
    const token = await seedInvite()
    const first = await db.user.create({ data: { name: 'A', email: 'a@x.com' } })
    const second = await db.user.create({ data: { name: 'B', email: 'b@x.com' } })

    await consumeInvite(token, first.id)
    const r = await consumeInvite(token, second.id)

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })

  it('süresi dolmuş daveti reddeder', async () => {
    const token = await seedInvite({ expiresAt: new Date(Date.now() - 1000) })
    const user = await db.user.create({ data: { name: 'C', email: 'c@x.com' } })
    const r = await consumeInvite(token, user.id)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })

  it('iptal edilmiş daveti reddeder', async () => {
    const token = await seedInvite({ revokedAt: new Date() })
    const user = await db.user.create({ data: { name: 'D', email: 'd@x.com' } })
    const r = await consumeInvite(token, user.id)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })

  it('bilinmeyen token için NOT_FOUND döner', async () => {
    const user = await db.user.create({ data: { name: 'E', email: 'e@x.com' } })
    const r = await consumeInvite('bilinmeyen-token', user.id)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  it('daveti kullanınca Activity kaydı düşer', async () => {
    const token = await seedInvite()
    const user = await db.user.create({ data: { name: 'F', email: 'f@x.com' } })
    await consumeInvite(token, user.id)
    const activity = await db.activity.findFirstOrThrow()
    expect(activity.verb).toBe('invite.accepted')
    expect(activity.actorId).toBe(user.id)
  })
})
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/integration/invites.test.ts`
Expected: FAIL — `@/server/invites` bulunamadı

- [ ] **Step 3: `activity.ts` yaz**

```ts
// src/lib/activity.ts
import type { Prisma, PrismaClient } from '@prisma/client'

type Client = PrismaClient | Prisma.TransactionClient

export async function recordActivity(
  client: Client,
  entry: {
    actorId: string
    verb: string
    entityType: string
    entityId: string
    meta?: Prisma.InputJsonValue
  },
): Promise<void> {
  await client.activity.create({ data: entry })
}
```

- [ ] **Step 4: `src/server/invites.ts` yaz**

```ts
'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { createInviteToken, hashInviteToken } from '@/lib/auth/invite-token'
import { recordActivity } from '@/lib/activity'
import { fail, ok, type Result } from '@/lib/result'

const INVITE_TTL_DAYS = 7

export const createInvite = defineAction({
  input: z.object({
    globalRole: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
    channelId: z.string().cuid().nullable().default(null),
    channelRole: z.enum(['LEAD', 'MEMBER']).default('MEMBER'),
  }),
  getActor,
  authorize: async ({ actor }) => ({ allowed: can(actor, 'invite:create', { kind: 'invite' }) }),
  handler: async ({ actor, input }) => {
    const { token, tokenHash } = createInviteToken()
    const invite = await db.invite.create({
      data: {
        tokenHash,
        globalRole: input.globalRole,
        channelId: input.channelId,
        channelRole: input.channelRole,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 864e5),
        createdById: actor.id,
      },
    })
    await recordActivity(db, {
      actorId: actor.id, verb: 'invite.created',
      entityType: 'Invite', entityId: invite.id,
    })
    // Ham token yalnızca burada, bir kez döner. Veritabanında hash'i durur.
    return { url: `${process.env.AUTH_URL}/invite/${token}`, id: invite.id }
  },
})

export const revokeInvite = defineAction({
  input: z.object({ inviteId: z.string().cuid() }),
  getActor,
  authorize: async ({ actor }) => ({ allowed: can(actor, 'invite:revoke', { kind: 'invite' }) }),
  handler: async ({ actor, input }) => {
    await db.invite.update({
      where: { id: input.inviteId },
      data: { revokedAt: new Date() },
    })
    await recordActivity(db, {
      actorId: actor.id, verb: 'invite.revoked',
      entityType: 'Invite', entityId: input.inviteId,
    })
    return { id: input.inviteId }
  },
})

> **Bu üç fonksiyon `src/server/invite-service.ts` içinde yaşar — `'use server'` YOK.**
> `'use server'` işaretli bir modülün her export'u ağdan çağrılabilir bir uç
> noktadır. `applyInvite` token istemez ve ADMIN rolü verir; action olarak
> yayınlanırsa kimlik doğrulaması olmayan bir yetki yükseltme uç noktası olur.
> Yalnızca `createInvite` ve `revokeInvite` action'dır ve `invites.ts`'te kalır.

```ts
// src/server/invite-service.ts  ('use server' YOK)
```

/**
 * Daveti ATOMİK olarak sahiplenir. Tek `updateMany`, tüm geçerlilik koşulları
 * `where` içinde: iki eşzamanlı istekten yalnızca biri `count === 1` alır.
 * Ayrı bir "önce oku, sonra yaz" adımı bırakılmaz — aradaki boşluk bir daveti
 * birden çok hesaba açar.
 */
export async function claimInvite(tokenHash: string): Promise<boolean> {
  const claimed = await db.invite.updateMany({
    where: {
      tokenHash,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  })
  return claimed.count === 1
}

/**
 * Sahiplenilmiş davetin etkilerini uygular. Sahiplenme ile ayrı tutulur:
 * kullanıcı satırı ancak kabul kararından SONRA var olur.
 */
export async function applyInvite(inviteId: string, userId: string): Promise<Result<{ channelId: string | null }>> {
  const invite = await db.invite.findUnique({ where: { id: inviteId } })
  if (!invite) return fail('NOT_FOUND')

  await db.$transaction(async (tx) => {
    await tx.invite.update({ where: { id: invite.id }, data: { usedByUserId: userId } })
    if (invite.globalRole === 'ADMIN') {
      await tx.user.update({ where: { id: userId }, data: { globalRole: 'ADMIN' } })
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
  })

  return ok({ channelId: invite.channelId })
}

/**
 * Zaten giriş yapmış kullanıcı için davet kullanımı (ikinci bir kanala davet).
 * Action değildir: yetki kontrolü token'ın kendisidir. Önce sahiplenir,
 * sonra uygular.
 */
export async function consumeInvite(
  token: string,
  userId: string,
): Promise<Result<{ channelId: string | null }>> {
  const tokenHash = hashInviteToken(token)
  const invite = await db.invite.findUnique({ where: { tokenHash } })
  if (!invite) return fail('NOT_FOUND')
  if (!(await claimInvite(tokenHash))) return fail('CONFLICT')
  return applyInvite(invite.id, userId)
}
```

- [ ] **Step 5: Testi çalıştır**

Run: `pnpm vitest run tests/integration/invites.test.ts`
Expected: PASS (6 test)

- [ ] **Step 6: Davet çerezi sabitini ayrı dosyada tanımla**

Sabit kendi dosyasında durur; sayfadan `auth/config.ts`'e import etmek döngüsel bağımlılık yaratır (`config` → `page` → `signIn` → `config`).

```ts
// src/lib/auth/invite-cookie.ts
export const INVITE_COOKIE = 'macs_invite'
export const INVITE_COOKIE_MAX_AGE = 900 // 15 dakika
```

- [ ] **Step 7: Davet karşılama sayfasını yaz**

```tsx
// src/app/invite/[token]/page.tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { hashInviteToken } from '@/lib/auth/invite-token'
import { signIn } from '@/lib/auth/config'
import { getActor } from '@/lib/auth/session'
import { consumeInvite } from '@/server/invites'
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE } from '@/lib/auth/invite-cookie'
import { Button } from '@/components/ui/button'

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ hata?: string }>
}) {
  const { token } = await params
  const failed = (await searchParams).hata === '1'
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { channel: true },
  })

  const invalid = !invite || invite.usedAt || invite.revokedAt || invite.expiresAt < new Date()
  if (invalid) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-sm space-y-2 text-center">
          <h1 className="text-xl font-semibold">Davet geçersiz</h1>
          <p className="text-sm text-muted-foreground">
            Bu davet kullanılmış, iptal edilmiş veya süresi dolmuş. Kulüp yönetiminden yeni bir link iste.
          </p>
        </div>
      </main>
    )
  }

  // Zaten giriş yapmışsa: onay iste. Render sırasında tüketmek yanlış olur —
  // tarayıcı ön yüklemesi (prefetch) daveti tıklamadan yakabilir ve üçüncü
  // bir taraf, oturumu açık kurbanı istemediği bir daveti kullanmaya
  // zorlayabilir (oturum çerezi sameSite=lax olduğu için üst düzey
  // gezinmede gönderilir).
  const actor = await getActor()
  if (actor) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="text-2xl font-semibold">Davetiye</h1>
          {invite.channel && (
            <p className="text-sm text-muted-foreground">
              <strong>{invite.channel.name}</strong> kanalına ekleneceksin.
            </p>
          )}
          <form
            action={async () => {
              'use server'
              const result = await consumeInvite(token, actor.id)
              if (!result.ok) redirect(`/invite/${token}?hata=1`)
              redirect('/')
            }}
          >
            <Button type="submit" className="w-full">Daveti kabul et</Button>
          </form>
          {failed && (
            <p className="text-sm text-destructive">
              Davet kullanılamadı. Kullanılmış, iptal edilmiş veya süresi dolmuş olabilir.
            </p>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold">MACS'e davet edildin</h1>
        {invite.channel && (
          <p className="text-sm text-muted-foreground">
            Kanal: <strong>{invite.channel.name}</strong>
          </p>
        )}
        <form
          action={async () => {
            'use server'
            // Token'ı httpOnly çerezde taşı: Google dönüşünde hangi davet
            // olduğunu bilmemiz gerekiyor, URL'de taşımak referrer sızıntısı riski.
            const store = await cookies()
            store.set(INVITE_COOKIE, token, {
              httpOnly: true, secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax', maxAge: INVITE_COOKIE_MAX_AGE, path: '/',
            })
            await signIn('google', { redirectTo: '/onboarding' })
          }}
        >
          <Button type="submit" className="w-full">Google ile devam et</Button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 8: `signIn` callback'ini davet zorunluluğu için güncelle**

`src/lib/auth/config.ts` içindeki `signIn` callback'ini şununla değiştir:

```ts
    async signIn({ user }) {
      if (!user.email) return false

      const existing = await db.user.findUnique({ where: { email: user.email } })
      if (existing) return existing.isActive

      // Yeni kullanıcı: davet BURADA sahiplenilir, sonraki isteğe bırakılmaz.
      // Sadece doğrulayıp geçmek, aynı linkin sınırsız hesap açmasına yol
      // açar: kullanıcı satırı bu callback true dönünce oluşur ve bir daha
      // hiç davet kontrolünden geçmez.
      const store = await cookies()
      const token = store.get(INVITE_COOKIE)?.value
      if (!token) return false
      return claimInvite(hashInviteToken(token))
    },
```

Dosyanın başına şu import'lar eklenir:

```ts
import { cookies } from 'next/headers'
import { hashInviteToken } from '@/lib/auth/invite-token'
import { INVITE_COOKIE } from '@/lib/auth/invite-cookie'
import { applyInvite, claimInvite } from '@/server/invites'
```

Ve `callbacks`'in yanına `events` eklenir — davetin etkileri kullanıcı satırı oluştuktan sonra uygulanır:

```ts
  events: {
    /**
     * `signIn` daveti sahiplendi ama kullanıcı henüz yoktu. Satır oluşunca
     * rol ve kanal üyeliği burada bağlanır. Sahiplenme başarısız olsaydı
     * bu noktaya hiç gelinmezdi.
     */
    async createUser({ user }) {
      if (!user.id) return
      const store = await cookies()
      const token = store.get(INVITE_COOKIE)?.value
      if (!token) return
      const invite = await db.invite.findUnique({
        where: { tokenHash: hashInviteToken(token) },
      })
      if (!invite || invite.usedByUserId) return
      await applyInvite(invite.id, user.id)
    },
  },
```

> **Takas, bilinçli:** davet sahiplenildikten sonra kullanıcı oluşturma başarısız olursa link yanmış olur ve admin yenisini üretir. Ters yön — önce kullanıcı, sonra sahiplenme — davetsiz hesap bırakır. Güvenli taraf budur.

- [ ] **Step 9: Doğrula ve commit**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

```bash
git add -A
git commit -m "feat: add invite creation, revocation and redemption flow"
```

---

## Task 10: Profil kurulumu (onboarding)

**Files:**
- Create: `src/server/profile.ts`, `src/app/onboarding/page.tsx`, `src/app/onboarding/profile-form.tsx`
- Create: `src/components/state/error-state.tsx`, `src/components/state/empty-state.tsx`
- Test: `tests/integration/profile.test.ts`

**Interfaces:**
- Consumes: `defineAction` (Task 8), `INVITE_COOKIE` (Task 9)
- Produces: `completeOnboarding({ name, title })` → `Result<{ id: string }>`; `User.onboardedAt` dolar.

- [ ] **Step 1: Başarısız olacak testi yaz**

```ts
// tests/integration/profile.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'

const actorRef: { current: { id: string } | null } = { current: null }
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () =>
    actorRef.current && {
      id: actorRef.current.id, globalRole: 'MEMBER' as const,
      isActive: true, memberships: [],
    },
}))

const { completeOnboarding } = await import('@/server/profile')

beforeEach(async () => {
  await db.activity.deleteMany()
  await db.user.deleteMany()
})

describe('completeOnboarding', () => {
  it('ad ve ünvanı kaydeder, onboardedAt doldurur', async () => {
    const user = await db.user.create({ data: { name: 'Google Adı', email: 'a@x.com' } })
    actorRef.current = { id: user.id }

    const r = await completeOnboarding({ name: 'Yusuf Efe', title: 'Proje Koordinatörü' })

    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(updated.name).toBe('Yusuf Efe')
    expect(updated.title).toBe('Proje Koordinatörü')
    expect(updated.onboardedAt).not.toBeNull()
  })

  it('boş ad için alan bazlı hata döner', async () => {
    const user = await db.user.create({ data: { name: 'X', email: 'b@x.com' } })
    actorRef.current = { id: user.id }

    const r = await completeOnboarding({ name: ' ', title: '' })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.fields?.name).toBe('Ad soyad zorunlu.')
  })

  it('oturum yoksa UNAUTHENTICATED döner', async () => {
    actorRef.current = null
    const r = await completeOnboarding({ name: 'Efe', title: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('UNAUTHENTICATED')
  })
})
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/integration/profile.test.ts`
Expected: FAIL — `@/server/profile` bulunamadı

- [ ] **Step 3: Implementasyon**

```ts
// src/server/profile.ts
'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { recordActivity } from '@/lib/activity'

export const completeOnboarding = defineAction({
  input: z.object({
    name: z.string().trim().min(1, 'Ad soyad zorunlu.').max(80, 'Ad soyad en fazla 80 karakter.'),
    title: z.string().trim().max(60, 'Ünvan en fazla 60 karakter.').default(''),
  }),
  getActor,
  // Kullanıcı yalnızca kendi profilini kurar; ayrı bir policy kuralı gerekmez.
  authorize: async () => ({ allowed: true }),
  handler: async ({ actor, input }) => {
    const user = await db.user.update({
      where: { id: actor.id },
      data: {
        name: input.name,
        title: input.title || null,
        onboardedAt: new Date(),
      },
    })
    await recordActivity(db, {
      actorId: actor.id, verb: 'member.joined',
      entityType: 'User', entityId: user.id,
    })
    return { id: user.id }
  },
})
```

- [ ] **Step 4: Testi çalıştır**

Run: `pnpm vitest run tests/integration/profile.test.ts`
Expected: PASS (3 test)

- [ ] **Step 5: Onboarding ekranını yaz**

```tsx
// src/app/onboarding/page.tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { INVITE_COOKIE } from '@/lib/auth/invite-cookie'
import { ProfileForm } from './profile-form'

export default async function OnboardingPage() {
  const actor = await requireActor()

  // Davet, giriş anında Auth.js tarafında sahiplenilip uygulandı (Task 9).
  // Burada yalnızca çerez temizlenir.
  const store = await cookies()
  store.delete(INVITE_COOKIE)

  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } })
  if (user.onboardedAt) redirect('/')

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Profilini tamamla</h1>
        <p className="text-sm text-muted-foreground">Kulüpte nasıl görüneceğini belirle.</p>
      </div>
      <ProfileForm defaultName={user.name} />
    </main>
  )
}
```

```tsx
// src/app/onboarding/profile-form.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { completeOnboarding } from '@/server/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ProfileForm({ defaultName }: { defaultName: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        startTransition(async () => {
          const result = await completeOnboarding({
            name: String(data.get('name') ?? ''),
            title: String(data.get('title') ?? ''),
          })
          if (result.ok) {
            router.replace('/')
            return
          }
          setFieldErrors(result.error.fields ?? {})
          setFormError(result.error.fields ? null : result.error.message)
        })
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="name">Ad soyad</Label>
        <Input id="name" name="name" defaultValue={defaultName} required />
        {fieldErrors.name && <p className="text-sm text-destructive">{fieldErrors.name}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="title">Ünvan</Label>
        <Input id="title" name="title" placeholder="Proje Koordinatörü" />
        {fieldErrors.title && <p className="text-sm text-destructive">{fieldErrors.title}</p>}
      </div>
      {formError && <p className="text-sm text-destructive">{formError}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Kaydediliyor…' : 'Devam et'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 6: Ortak durum bileşenlerini yaz**

```tsx
// src/components/state/error-state.tsx
'use client'

import { Button } from '@/components/ui/button'

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Tekrar dene</Button>}
    </div>
  )
}
```

```tsx
// src/components/state/empty-state.tsx
import type { ReactNode } from 'react'

export function EmptyState({
  title, description, action,
}: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  )
}
```

- [ ] **Step 7: Doğrula ve commit**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

```bash
git add -A
git commit -m "feat: add onboarding profile setup and shared state components"
```

---

## Task 11: Kanal yönetimi ve uygulama kabuğu

**Files:**
- Create: `src/lib/slug.ts`, `src/server/channels.ts`
- Create: `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/c/[slug]/page.tsx`
- Create: `src/components/layout/sidebar.tsx`
- Test: `tests/unit/slug.test.ts`, `tests/integration/channels.test.ts`

> **Dikkat:** `'use server'` işaretli bir dosya yalnızca async fonksiyon dışa aktarabilir. Bu yüzden senkron `slugify` ayrı bir dosyada (`src/lib/slug.ts`) durur; `src/server/channels.ts` içine konursa build hata verir.

**Interfaces:**
- Consumes: `defineAction` (Task 8), `can` (Task 5), `recordActivity` (Task 9)
- Produces:
  - `createChannel({ name, visibility })` → `Result<{ id: string; slug: string }>`
  - `addChannelMember({ channelId, userId, channelRole })` → `Result<{ id: string }>`
  - `removeChannelMember({ channelId, userId })` → `Result<{ ok: true }>`
  - `listVisibleChannels(actor)` — sunucu içi sorgu yardımcısı

- [ ] **Step 1: `slugify` testini yaz ve başarısız olduğunu gör**

```ts
// tests/unit/slug.test.ts
import { describe, expect, it } from 'vitest'
import { slugify } from '@/lib/slug'

describe('slugify', () => {
  it('Türkçe karakterleri ASCII karşılığına çevirir', () => {
    expect(slugify('Proje Koordinatörlüğü')).toBe('proje-koordinatorlugu')
    expect(slugify('Sponsorluk & İletişim')).toBe('sponsorluk-iletisim')
  })

  it('baştaki ve sondaki tireleri temizler', () => {
    expect(slugify('  --Medya!!  ')).toBe('medya')
  })
})
```

Run: `pnpm vitest run tests/unit/slug.test.ts`
Expected: FAIL — `@/lib/slug` bulunamadı

- [ ] **Step 2: `slugify`'ı yaz ve testi geçir**

```ts
// src/lib/slug.ts
const TR_MAP: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u',
}

export function slugify(name: string): string {
  return name
    .replace(/[çğıİöşü]/g, (ch) => TR_MAP[ch] ?? ch)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
```

Run: `pnpm vitest run tests/unit/slug.test.ts`
Expected: PASS (2 test)

- [ ] **Step 3: Kanal testlerini yaz (başarısız olacak)**

```ts
// tests/integration/channels.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'

const actorRef: { current: { id: string; globalRole: 'ADMIN' | 'MEMBER' } | null } = { current: null }

vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () => {
    if (!actorRef.current) return null
    const user = await db.user.findUniqueOrThrow({
      where: { id: actorRef.current.id },
      include: { memberships: true },
    })
    return {
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
    }
  },
}))

const { addChannelMember, createChannel, listVisibleChannels } = await import('@/server/channels')

let admin: { id: string }
let plain: { id: string }

beforeEach(async () => {
  await db.activity.deleteMany()
  await db.channelMember.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
  admin = await db.user.create({ data: { name: 'Admin', globalRole: 'ADMIN' } })
  plain = await db.user.create({ data: { name: 'Üye' } })
})

describe('createChannel', () => {
  it('admin kanal açar ve slug üretilir', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const r = await createChannel({ name: 'Proje Koordinatörlüğü', visibility: 'OPEN' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.slug).toBe('proje-koordinatorlugu')
  })

  it('aynı isimde ikinci kanalda slug çakışmaz', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    await createChannel({ name: 'Medya', visibility: 'OPEN' })
    const second = await createChannel({ name: 'Medya', visibility: 'OPEN' })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.slug).toBe('medya-2')
  })

  it('kanalı açan kişi otomatik LEAD olur', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const r = await createChannel({ name: 'Tasarım', visibility: 'OPEN' })
    if (!r.ok) throw new Error('beklenmedik hata')
    const member = await db.channelMember.findUniqueOrThrow({
      where: { channelId_userId: { channelId: r.data.id, userId: admin.id } },
    })
    expect(member.channelRole).toBe('LEAD')
  })

  it('düz üye kanal açamaz', async () => {
    actorRef.current = { id: plain.id, globalRole: 'MEMBER' }
    const r = await createChannel({ name: 'Yasak', visibility: 'OPEN' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })
})

describe('addChannelMember', () => {
  it('kanal dışından biri üye ekleyemez', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const created = await createChannel({ name: 'Sponsorluk', visibility: 'PRIVATE' })
    if (!created.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: plain.id, globalRole: 'MEMBER' }
    const r = await addChannelMember({
      channelId: created.data.id, userId: plain.id, channelRole: 'MEMBER',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })
})

describe('listVisibleChannels', () => {
  it('PRIVATE kanal üye olmayana görünmez, OPEN görünür', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    await createChannel({ name: 'Herkese Açık', visibility: 'OPEN' })
    await createChannel({ name: 'Gizli', visibility: 'PRIVATE' })

    const forPlain = await listVisibleChannels({
      id: plain.id, globalRole: 'MEMBER', isActive: true, memberships: [],
    })
    expect(forPlain.map((c) => c.name)).toEqual(['Herkese Açık'])
  })
})
```

- [ ] **Step 4: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/integration/channels.test.ts`
Expected: FAIL — `@/server/channels` bulunamadı

- [ ] **Step 5: Implementasyon**

```ts
// src/server/channels.ts
'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { type Actor, can } from '@/lib/auth/policy'
import { recordActivity } from '@/lib/activity'

import { slugify } from '@/lib/slug'

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base
  let suffix = 1
  while (await db.channel.findUnique({ where: { slug: candidate } })) {
    suffix += 1
    candidate = `${base}-${suffix}`
  }
  return candidate
}

export const createChannel = defineAction({
  input: z.object({
    name: z.string().trim().min(2, 'Kanal adı en az 2 karakter.').max(60, 'Kanal adı en fazla 60 karakter.'),
    visibility: z.enum(['OPEN', 'PRIVATE']).default('OPEN'),
    description: z.string().trim().max(200).default(''),
  }),
  getActor,
  authorize: async ({ actor }) => ({ allowed: can(actor, 'channel:create', { kind: 'channel:new' }) }),
  handler: async ({ actor, input }) => {
    const slug = await uniqueSlug(slugify(input.name))
    const channel = await db.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          name: input.name,
          slug,
          visibility: input.visibility,
          description: input.description || null,
          createdById: actor.id,
          members: { create: { userId: actor.id, channelRole: 'LEAD' } },
        },
      })
      await recordActivity(tx, {
        actorId: actor.id, verb: 'channel.created',
        entityType: 'Channel', entityId: created.id, meta: { name: created.name },
      })
      return created
    })
    return { id: channel.id, slug: channel.slug }
  },
})

export const addChannelMember = defineAction({
  input: z.object({
    channelId: z.string().cuid(),
    userId: z.string().cuid(),
    channelRole: z.enum(['LEAD', 'MEMBER']).default('MEMBER'),
  }),
  getActor,
  authorize: async ({ actor, input }) => {
    const channel = await db.channel.findUnique({ where: { id: input.channelId } })
    if (!channel) return { allowed: false, code: 'NOT_FOUND' as const }
    return {
      allowed: can(actor, 'channel:manageMembers', {
        kind: 'channel', id: channel.id,
        visibility: channel.visibility, archivedAt: channel.archivedAt,
      }),
    }
  },
  handler: async ({ actor, input }) => {
    const member = await db.channelMember.upsert({
      where: { channelId_userId: { channelId: input.channelId, userId: input.userId } },
      create: { channelId: input.channelId, userId: input.userId, channelRole: input.channelRole },
      update: { channelRole: input.channelRole },
    })
    await recordActivity(db, {
      actorId: actor.id, verb: 'channel.memberAdded',
      entityType: 'Channel', entityId: input.channelId, meta: { userId: input.userId },
    })
    return { id: member.id }
  },
})

export const removeChannelMember = defineAction({
  input: z.object({ channelId: z.string().cuid(), userId: z.string().cuid() }),
  getActor,
  authorize: async ({ actor, input }) => {
    const channel = await db.channel.findUnique({ where: { id: input.channelId } })
    if (!channel) return { allowed: false, code: 'NOT_FOUND' as const }
    return {
      allowed: can(actor, 'channel:manageMembers', {
        kind: 'channel', id: channel.id,
        visibility: channel.visibility, archivedAt: channel.archivedAt,
      }),
    }
  },
  handler: async ({ actor, input }) => {
    await db.channelMember.deleteMany({
      where: { channelId: input.channelId, userId: input.userId },
    })
    await recordActivity(db, {
      actorId: actor.id, verb: 'channel.memberRemoved',
      entityType: 'Channel', entityId: input.channelId, meta: { userId: input.userId },
    })
    return { ok: true as const }
  },
})

// src/server/channels-query.ts — 'use server' YOK. Kimliği çağırandan değil,
// oturumdan alır: parametre olarak Actor kabul eden bir export, action
// modülünde yayınlanırsa sahte Actor ile çağrılabilir.
export async function listVisibleChannels() {
  const actor = await getActor()
  if (!actor) return []
  const memberChannelIds = actor.memberships.map((m) => m.channelId)
  return db.channel.findMany({
    where: {
      archivedAt: null,
      ...(actor.globalRole === 'ADMIN'
        ? {}
        : { OR: [{ visibility: 'OPEN' }, { id: { in: memberChannelIds } }] }),
    },
    orderBy: { name: 'asc' },
  })
}
```

- [ ] **Step 6: Testi çalıştır**

Run: `pnpm vitest run tests/integration/channels.test.ts`
Expected: PASS (6 test)

- [ ] **Step 7: Sidebar ve uygulama kabuğunu yaz**

```tsx
// src/components/layout/sidebar.tsx
import Link from 'next/link'
import type { Actor } from '@/lib/auth/policy'
import { listVisibleChannels } from '@/server/channels'

export async function Sidebar({ actor }: { actor: Actor }) {
  const channels = await listVisibleChannels(actor)
  const mine = new Set(actor.memberships.map((m) => m.channelId))

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col gap-6 border-r bg-muted/30 p-4">
      <Link href="/" className="text-lg font-semibold">MACS</Link>

      <div className="space-y-1 text-sm">
        <Link href="/" className="block rounded px-2 py-1 hover:bg-muted">Ana sayfa</Link>
        <Link href="/members" className="block rounded px-2 py-1 hover:bg-muted">Üyeler</Link>
        {actor.globalRole === 'ADMIN' && (
          <Link href="/admin" className="block rounded px-2 py-1 hover:bg-muted">Yönetim</Link>
        )}
      </div>

      <div className="space-y-1">
        <p className="px-2 text-xs font-medium uppercase text-muted-foreground">Kanallarım</p>
        {channels.filter((c) => mine.has(c.id)).map((c) => (
          <Link key={c.id} href={`/c/${c.slug}`} className="block rounded px-2 py-1 text-sm hover:bg-muted">
            {c.icon ?? '#'} {c.name}
          </Link>
        ))}
        {channels.filter((c) => mine.has(c.id)).length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">Henüz bir kanalda değilsin.</p>
        )}
      </div>

      <div className="space-y-1">
        <p className="px-2 text-xs font-medium uppercase text-muted-foreground">Diğer kanallar</p>
        {channels.filter((c) => !mine.has(c.id)).map((c) => (
          <Link key={c.id} href={`/c/${c.slug}`} className="block rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
            {c.icon ?? '#'} {c.name}
          </Link>
        ))}
      </div>
    </nav>
  )
}
```

```tsx
// src/app/(app)/layout.tsx
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { Sidebar } from '@/components/layout/sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor()
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } })
  if (!user.onboardedAt) redirect('/onboarding')

  return (
    <div className="flex min-h-dvh">
      <div className="hidden md:block"><Sidebar actor={actor} /></div>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
```

```tsx
// src/app/(app)/page.tsx
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { EmptyState } from '@/components/state/empty-state'

export default async function HomePage() {
  await requireActor()
  const activities = await db.activity.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { actor: { select: { name: true } } },
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Ana sayfa</h1>
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase text-muted-foreground">Son hareketler</h2>
        {activities.length === 0 ? (
          <EmptyState
            title="Henüz hareket yok"
            description="Kanal açıldıkça ve içerik eklendikçe burada görünecek."
          />
        ) : (
          <ul className="space-y-2 text-sm">
            {activities.map((a) => (
              <li key={a.id} className="flex justify-between rounded border px-3 py-2">
                <span>{a.actor.name} — {a.verb}</span>
                <time className="text-muted-foreground">
                  {a.createdAt.toLocaleDateString('tr-TR')}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

```tsx
// src/app/(app)/c/[slug]/page.tsx
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { EmptyState } from '@/components/state/empty-state'

export default async function ChannelPage({ params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireActor()
  const { slug } = await params
  const channel = await db.channel.findUnique({
    where: { slug },
    include: { members: { include: { user: { select: { id: true, name: true, title: true } } } } },
  })
  if (!channel || channel.archivedAt) notFound()

  // Yetki kontrolü veriyi göstermeden önce. Erişim yoksa varlığı da sızdırılmaz.
  const allowed = can(actor, 'channel:read', {
    kind: 'channel', id: channel.id,
    visibility: channel.visibility, archivedAt: channel.archivedAt,
  })
  if (!allowed) notFound()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{channel.name}</h1>
        {channel.description && (
          <p className="text-sm text-muted-foreground">{channel.description}</p>
        )}
      </header>
      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase text-muted-foreground">Üyeler</h2>
        <ul className="space-y-1 text-sm">
          {channel.members.map((m) => (
            <li key={m.id}>{m.user.name} {m.channelRole === 'LEAD' && '· Lider'}</li>
          ))}
        </ul>
      </section>
      <EmptyState
        title="İçerik henüz yok"
        description="Doküman, görev ve etkinlikler sonraki sürümde bu sayfada listelenecek."
      />
    </div>
  )
}
```

- [ ] **Step 8: Doğrula ve commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS

```bash
git add -A
git commit -m "feat: add channel management, sidebar and app shell"
```

---

## Task 12: Üye yönetimi ve pasife alma

**Files:**
- Create: `src/server/members.ts`, `src/app/(app)/members/page.tsx`, `src/app/(app)/admin/page.tsx`
- Test: `tests/integration/members.test.ts`

**Interfaces:**
- Consumes: `defineAction` (Task 8), `can` (Task 5)
- Produces:
  - `deactivateMember({ userId })` → `Result<{ id: string }>` — `isActive=false`, tüm `Session` satırları silinir
  - `updateMemberRole({ userId, globalRole })` → `Result<{ id: string }>`

> Not: Spec'teki "ayrılan üyenin PRIVATE dokümanları admin'e devredilir" ve "atanmış görevleri boşa düşer" kuralları `Document` ve `Task` modelleri Plan 2 ve Plan 3'te geldiğinde `deactivateMember` içine eklenir. Bu plan yalnızca oturum sonlandırma ve pasifleştirmeyi kapsar.

- [ ] **Step 1: Başarısız olacak testi yaz**

```ts
// tests/integration/members.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'

const actorRef: { current: string | null } = { current: null }
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () => {
    if (!actorRef.current) return null
    const user = await db.user.findUniqueOrThrow({
      where: { id: actorRef.current }, include: { memberships: true },
    })
    return {
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
    }
  },
}))

const { deactivateMember } = await import('@/server/members')

let admin: { id: string }
let target: { id: string }

beforeEach(async () => {
  await db.activity.deleteMany()
  await db.session.deleteMany()
  await db.channelMember.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
  admin = await db.user.create({ data: { name: 'Admin', globalRole: 'ADMIN' } })
  target = await db.user.create({ data: { name: 'Ayrılan' } })
})

describe('deactivateMember', () => {
  it('üyeyi pasife alır ve tüm oturumlarını siler', async () => {
    await db.session.create({
      data: { sessionToken: 'tok', userId: target.id, expires: new Date(Date.now() + 864e5) },
    })
    actorRef.current = admin.id

    const r = await deactivateMember({ userId: target.id })

    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(updated.isActive).toBe(false)
    expect(await db.session.count({ where: { userId: target.id } })).toBe(0)
  })

  it('düz üye başkasını pasife alamaz', async () => {
    actorRef.current = target.id
    const r = await deactivateMember({ userId: admin.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('admin kendini pasife alamaz', async () => {
    actorRef.current = admin.id
    const r = await deactivateMember({ userId: admin.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })
})
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/integration/members.test.ts`
Expected: FAIL — `@/server/members` bulunamadı

- [ ] **Step 3: Implementasyon**

```ts
// src/server/members.ts
'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { recordActivity } from '@/lib/activity'

export const deactivateMember = defineAction({
  input: z.object({ userId: z.string().cuid() }),
  getActor,
  authorize: async ({ actor, input }) => ({
    allowed: can(actor, 'member:deactivate', { kind: 'member', id: input.userId }),
  }),
  handler: async ({ actor, input }) => {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: input.userId }, data: { isActive: false } })
      // Oturumların silinmesi zorunludur: aksi halde pasife alınan kullanıcı
      // mevcut çerezle çalışmaya devam eder.
      await tx.session.deleteMany({ where: { userId: input.userId } })
      await recordActivity(tx, {
        actorId: actor.id, verb: 'member.deactivated',
        entityType: 'User', entityId: input.userId,
      })
    })
    return { id: input.userId }
  },
})

export const updateMemberRole = defineAction({
  input: z.object({ userId: z.string().cuid(), globalRole: z.enum(['ADMIN', 'MEMBER']) }),
  getActor,
  authorize: async ({ actor, input }) => ({
    allowed: can(actor, 'member:updateRole', { kind: 'member', id: input.userId }),
  }),
  handler: async ({ actor, input }) => {
    await db.user.update({ where: { id: input.userId }, data: { globalRole: input.globalRole } })
    await recordActivity(db, {
      actorId: actor.id, verb: 'member.roleChanged',
      entityType: 'User', entityId: input.userId, meta: { globalRole: input.globalRole },
    })
    return { id: input.userId }
  },
})
```

- [ ] **Step 4: Testi çalıştır**

Run: `pnpm vitest run tests/integration/members.test.ts`
Expected: PASS (3 test)

- [ ] **Step 5: Üye listesi ve admin ekranlarını yaz**

```tsx
// src/app/(app)/members/page.tsx
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { EmptyState } from '@/components/state/empty-state'

export default async function MembersPage() {
  await requireActor()
  const members = await db.user.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: { memberships: { include: { channel: { select: { name: true } } } } },
  })

  if (members.length === 0) {
    return <EmptyState title="Üye yok" description="Davet gönderildikçe burada görünecekler." />
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Üyeler</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-2">Ad</th><th>Ünvan</th><th>Kanallar</th></tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="border-t">
              <td className="py-2">{m.name}</td>
              <td>{m.title ?? '—'}</td>
              <td>{m.memberships.map((x) => x.channel.name).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

```tsx
// src/app/(app)/admin/page.tsx
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'

export default async function AdminPage() {
  const actor = await requireActor()
  if (!can(actor, 'invite:list', { kind: 'invite' })) notFound()

  const [invites, channels] = await Promise.all([
    db.invite.findMany({
      orderBy: { createdAt: 'desc' }, take: 50,
      include: { channel: { select: { name: true } }, usedBy: { select: { name: true } } },
    }),
    db.channel.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' } }),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold">Yönetim</h1>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase text-muted-foreground">Kanallar</h2>
        <ul className="space-y-1 text-sm">
          {channels.map((c) => (
            <li key={c.id}>
              {c.name} · {c.visibility === 'PRIVATE' ? 'Sadece üyeler' : 'Tüm kulüp'}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase text-muted-foreground">Davetler</h2>
        <ul className="space-y-1 text-sm">
          {invites.map((i) => (
            <li key={i.id}>
              {i.channel?.name ?? 'Kanalsız'} ·{' '}
              {i.usedBy ? `kullanıldı: ${i.usedBy.name}` :
               i.revokedAt ? 'iptal edildi' :
               i.expiresAt < new Date() ? 'süresi doldu' : 'bekliyor'}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] **Step 6: Doğrula ve commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS

```bash
git add -A
git commit -m "feat: add member management, member list and admin screen"
```

---

## Task 13: E2E testler ve seed

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/invite-flow.spec.ts`, `tests/e2e/authorization.spec.ts`
- Create: `prisma/seed.ts`
- Modify: `.github/workflows/ci.yml`
- Test: yukarıdaki spec dosyaları

**Interfaces:**
- Consumes: tüm önceki task'lar
- Produces: `pnpm test:e2e` komutu ve `pnpm db:seed`

- [ ] **Step 1: Playwright'ı kur**

```bash
pnpm add -D @playwright/test && pnpm exec playwright install --with-deps chromium
```

- [ ] **Step 2: `playwright.config.ts` yaz**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:3100' },
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
  },
})
```

**Testler nasıl giriş yapar:** uygulamada test amaçlı giriş yolu **yoktur**. Test, Auth.js'in okuduğu yeri doğrudan hazırlar: `Session` tablosuna satır yazar ve aynı opak token'ı çereze koyar. Böylece test, production'daki gerçek okuma yolunu doğrular — taklit etmez.

```ts
// tests/e2e/helpers/session.ts
import { randomBytes } from 'node:crypto'
import type { BrowserContext } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

export async function signInAs(context: BrowserContext, userId: string): Promise<void> {
  const sessionToken = randomBytes(32).toString('hex')
  await db.session.create({
    data: { sessionToken, userId, expires: new Date(Date.now() + 864e5) },
  })
  await context.addCookies([
    {
      name: 'authjs.session-token', // https altında __Secure- ön eki gelir
      value: sessionToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 86_400,
    },
  ])
}
```

- [ ] **Step 3: Seed script'ini yaz**

```ts
// prisma/seed.ts
import { PrismaClient } from '@prisma/client'
import { createInviteToken } from '../src/lib/auth/invite-token'

const db = new PrismaClient()

async function main() {
  const admin = await db.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      name: 'Kurucu Admin', email: 'admin@example.com',
      globalRole: 'ADMIN', onboardedAt: new Date(),
    },
  })

  const channel = await db.channel.upsert({
    where: { slug: 'genel' },
    update: {},
    create: {
      name: 'Genel', slug: 'genel', visibility: 'OPEN', createdById: admin.id,
      members: { create: { userId: admin.id, channelRole: 'LEAD' } },
    },
  })

  const { token, tokenHash } = createInviteToken()
  await db.invite.create({
    data: {
      tokenHash, channelId: channel.id, channelRole: 'MEMBER',
      expiresAt: new Date(Date.now() + 7 * 864e5), createdById: admin.id,
    },
  })
  console.log(`Davet linki: http://localhost:3100/invite/${token}`)
}

main().finally(() => db.$disconnect())
```

`package.json` içine:

```jsonc
{
  "prisma": { "seed": "tsx prisma/seed.ts" },
  "scripts": { "db:seed": "prisma db seed", "test:e2e": "playwright test" }
}
```

`pnpm add -D tsx` ile `tsx` eklenir.

- [ ] **Step 4: Davet akışı E2E testini yaz**

```ts
// tests/e2e/invite-flow.spec.ts
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { createInviteToken } from '../../src/lib/auth/invite-token'

const db = new PrismaClient()

test('süresi dolmuş davet reddedilir', async ({ page }) => {
  const admin = await db.user.create({
    data: { name: 'Admin', email: `a-${Date.now()}@x.com`, globalRole: 'ADMIN', onboardedAt: new Date() },
  })
  const { token, tokenHash } = createInviteToken()
  await db.invite.create({
    data: { tokenHash, expiresAt: new Date(Date.now() - 1000), createdById: admin.id },
  })

  await page.goto(`/invite/${token}`)
  await expect(page.getByText('Davet geçersiz')).toBeVisible()
})

test("bilinmeyen davet token'ı geçersiz sayfası gösterir", async ({ page }) => {
  await page.goto('/invite/gecersiz-token-123')
  await expect(page.getByText('Davet geçersiz')).toBeVisible()
})
```

- [ ] **Step 5: Yetkisiz erişim E2E testini yaz**

```ts
// tests/e2e/authorization.spec.ts
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

test("oturumsuz kullanıcı uygulamaya giremez, login'e yönlenir", async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: 'Google ile devam et' })).toBeVisible()
})

test('PRIVATE kanal üye olmayana 404 döner', async ({ page, context }) => {
  const stamp = Date.now()
  const owner = await db.user.create({
    data: { name: 'Sahip', email: `o-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const outsider = await db.user.create({
    data: { name: 'Yabancı', email: `x-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const channel = await db.channel.create({
    data: {
      name: `Gizli ${stamp}`, slug: `gizli-${stamp}`, visibility: 'PRIVATE',
      createdById: owner.id, members: { create: { userId: owner.id, channelRole: 'LEAD' } },
    },
  })

  await signInAs(context, outsider.id)

  const response = await page.goto(`/c/${channel.slug}`)
  expect(response?.status()).toBe(404)
})
```

Dosyanın başına `import { signInAs } from './helpers/session'` eklenir.

- [ ] **Step 6: Testleri çalıştır**

Run: `pnpm db:reset && pnpm test:e2e`
Expected: PASS (4 test)

- [ ] **Step 7: CI'ya E2E adımını ekle**

`.github/workflows/ci.yml` içindeki `check` job'ının sonuna:

```yaml
      - run: pnpm prisma migrate deploy
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test: add e2e coverage for invite and authorization flows"
```

---

## Task 14: Production deploy, Caddy ve yedekleme

**Files:**
- Create: `compose.yml`, `Caddyfile`, `scripts/backup.sh`
- Create: `.github/workflows/deploy.yml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `Dockerfile` (Task 2), CI (Task 1/13)
- Produces: `docker compose up -d` ile ayağa kalkan production stack; gecelik yedek cron'u.

- [ ] **Step 1: `compose.yml` yaz**

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ['80:80', '443:443']
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [web]

  # Kısa ömürlü migration job'ı. Şemayı uygular ve çıkar; web ona bağlıdır.
  # Migration'ın web container'ının CMD'sinde olmamasının iki sebebi:
  # (1) prisma CLI ayrı bir devDependency paketidir, standalone imajda yoktur;
  # (2) web birden fazla replikaya çıktığında eşzamanlı migrate yarışı olur.
  migrate:
    image: ghcr.io/${GH_OWNER}/macs-migrate:${IMAGE_TAG:-latest}
    restart: 'no'
    environment:
      DATABASE_URL: postgresql://macs:${POSTGRES_PASSWORD}@db:5432/macs
    depends_on:
      db: { condition: service_healthy }

  web:
    image: ghcr.io/${GH_OWNER}/macs-web:${IMAGE_TAG:-latest}
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://macs:${POSTGRES_PASSWORD}@db:5432/macs
      AUTH_SECRET: ${AUTH_SECRET}
      AUTH_URL: ${AUTH_URL}
      AUTH_GOOGLE_ID: ${AUTH_GOOGLE_ID}
      AUTH_GOOGLE_SECRET: ${AUTH_GOOGLE_SECRET}
      AUTH_TRUST_HOST: 'true'
    depends_on:
      db: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }

  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: macs
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: macs
    volumes: ['pgdata:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U macs']
      interval: 10s
      retries: 5

volumes:
  pgdata:
  caddy_data:
  caddy_config:
```

> `collab` servisi Plan 2'de bu dosyaya eklenir.

**Güvenlik notu:** uygulamada test amaçlı giriş yolu yoktur — tek kimlik sağlayıcısı Google'dır. E2E testleri `Session` tablosuna satır yazarak giriş yapar; bu yol yalnızca test sürecinde, veritabanına doğrudan erişimle mümkündür ve production kodunda karşılığı bulunmaz.

- [ ] **Step 2: `Caddyfile` yaz**

```
{$DOMAIN} {
	encode gzip
	reverse_proxy web:3000
}
```

- [ ] **Step 3: Yedekleme script'ini yaz**

```bash
#!/usr/bin/env bash
# scripts/backup.sh — gecelik cron ile çalıştırılır
set -euo pipefail

STAMP=$(date +%Y%m%d-%H%M%S)
OUT_DIR=/var/backups/macs
mkdir -p "$OUT_DIR"

docker compose exec -T db pg_dump -U macs macs | gzip > "$OUT_DIR/db-$STAMP.sql.gz"
docker run --rm -v macs_uploads:/data -v "$OUT_DIR":/out alpine \
  tar czf "/out/uploads-$STAMP.tar.gz" -C /data .

# Offsite kopya
rclone copy "$OUT_DIR" "macs-backup:macs/$(date +%Y-%m)" --max-age 24h

# 30 günden eski yerel yedekleri temizle
find "$OUT_DIR" -type f -mtime +30 -delete
```

Cron: `0 3 * * * /opt/macs/scripts/backup.sh >> /var/log/macs-backup.log 2>&1`

- [ ] **Step 4: Deploy workflow'unu yaz**

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  workflow_run:
    workflows: [CI]
    branches: [main]
    types: [completed]

jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: web imajı
        uses: docker/build-push-action@v6
        with:
          push: true
          target: run
          tags: ghcr.io/${{ github.repository_owner }}/macs-web:${{ github.sha }},ghcr.io/${{ github.repository_owner }}/macs-web:latest
      - name: migrate imajı
        uses: docker/build-push-action@v6
        with:
          push: true
          target: migrate
          tags: ghcr.io/${{ github.repository_owner }}/macs-migrate:${{ github.sha }},ghcr.io/${{ github.repository_owner }}/macs-migrate:latest
      - name: VPS'te güncelle
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/macs
            IMAGE_TAG=${{ github.sha }} docker compose pull web migrate
            IMAGE_TAG=${{ github.sha }} docker compose up -d
            docker image prune -f
```

- [ ] **Step 5: Yedeği geri yüklemeyi elle dene**

Bu adım atlanamaz. Denenmemiş yedek yedek sayılmaz.

```bash
# Sunucuda, ayrı bir test veritabanına
gunzip -c /var/backups/macs/db-<STAMP>.sql.gz | \
  docker compose exec -T db psql -U macs -d postgres -c 'CREATE DATABASE macs_restore_test;' -
gunzip -c /var/backups/macs/db-<STAMP>.sql.gz | \
  docker compose exec -T db psql -U macs -d macs_restore_test
docker compose exec -T db psql -U macs -d macs_restore_test -c 'SELECT count(*) FROM "User";'
docker compose exec -T db psql -U macs -d postgres -c 'DROP DATABASE macs_restore_test;'
```

Expected: `User` sayısı production ile aynı.

- [ ] **Step 6: `.env.example`'ı production değişkenleriyle güncelle**

```bash
DATABASE_URL=postgresql://macs:macs@localhost:5432/macs
AUTH_SECRET=
AUTH_URL=https://ornek-domain.com
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
POSTGRES_PASSWORD=
DOMAIN=ornek-domain.com
GH_OWNER=
IMAGE_TAG=latest
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: add production compose, caddy, deploy workflow and backups"
```

---

## Task 15: Kurulum daveti — ilk admin sisteme nasıl girer

Boş bir kurulumda hiç kullanıcı yoktur, dolayısıyla daveti üretecek kimse de yoktur. Önceki seed bunu hayalet bir `admin@example.com` kullanıcısı uydurarak çözmeye çalışıyordu; o satıra kimse giriş yapamaz (Google, var olan bir kullanıcıya OAuth hesabını kendiliğinden bağlamaz, `AccountNotLinked` verir) ve bastığı davet yalnızca `MEMBER` yetkisi taşıyordu. Sonuç: sistemde bir admin görünür ama kimse admin olamaz.

**Files:**
- Modify: `prisma/schema.prisma` (`Invite.createdById` → nullable), yeni migration
- Rewrite: `prisma/seed.ts`
- Test: `tests/integration/seed.test.ts`

**Interfaces:**
- Consumes: `createInviteToken` (Task 6), `claimInvite`/`applyInvite` (Task 9)
- Produces: `pnpm db:seed` — boş veritabanında tek bir sistem daveti üretir ve linkini bir kez basar

- [ ] **Step 1: Şemayı gevşet ve migration üret**

`Invite.createdById` `String?` olur, `createdBy` ilişkisi `User?` olur. Migration adı: `system_invite`.

- [ ] **Step 2: Başarısız olacak testi yaz**

```ts
// tests/integration/seed.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'
import { seedBootstrapInvite } from '../../prisma/seed'

beforeEach(resetDb)

describe('seedBootstrapInvite', () => {
  it('boş veritabanında ADMIN yetkili, sahipsiz bir davet üretir', async () => {
    const result = await seedBootstrapInvite()

    expect(result.ok).toBe(true)
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.globalRole).toBe('ADMIN')
    expect(invite.createdById).toBeNull()
    expect(invite.channelId).toBeNull()
    expect(await db.user.count()).toBe(0)
  })

  it('ham token veritabanına yazılmaz', async () => {
    const result = await seedBootstrapInvite()
    if (!result.ok) throw new Error('beklenmedik')
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.tokenHash).not.toBe(result.token)
    expect(result.url).toContain(result.token)
  })

  it('sistemde kullanıcı varsa çalışmayı reddeder', async () => {
    await db.user.create({ data: { name: 'Var Olan', email: 'a@x.com' } })
    const result = await seedBootstrapInvite()
    expect(result.ok).toBe(false)
    expect(await db.invite.count()).toBe(0)
  })
})
```

- [ ] **Step 3: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/integration/seed.test.ts`
Expected: FAIL — `seedBootstrapInvite` dışa aktarılmamış

- [ ] **Step 4: Seed'i yeniden yaz**

```ts
// prisma/seed.ts
import { PrismaClient } from '@prisma/client'
import { createInviteToken } from '../src/lib/auth/invite-token'

const db = new PrismaClient()

const INVITE_TTL_DAYS = 7

type SeedResult =
  | { ok: true; token: string; url: string }
  | { ok: false; reason: string }

/**
 * Kurulum daveti: sahipsiz (`createdById: null`), ADMIN yetkili, kanalsız.
 * Davetli linki açıp Google ile girer; `events.createUser` onu ADMIN yapar
 * ve ilk kanalı kendisi açar. Böylece ilk kullanıcı da herkesle aynı
 * yoldan girer — giriş akışında kuruluma özel bir istisna yoktur.
 */
export async function seedBootstrapInvite(): Promise<SeedResult> {
  // Canlı bir sistemde çalıştırılırsa sessizce admin daveti üretmemeli.
  if ((await db.user.count()) > 0) {
    return { ok: false, reason: 'Sistemde zaten kullanıcı var; kurulum daveti üretilmedi.' }
  }

  const { token, tokenHash } = createInviteToken()
  await db.invite.create({
    data: {
      tokenHash,
      globalRole: 'ADMIN',
      channelId: null,
      createdById: null,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 864e5),
    },
  })

  const base = process.env.AUTH_URL ?? 'http://localhost:3100'
  return { ok: true, token, url: `${base}/invite/${token}` }
}

async function main() {
  const result = await seedBootstrapInvite()
  if (!result.ok) {
    console.log(result.reason)
    return
  }
  console.log('\nKurulum daveti üretildi. Bu link bir kez gösterilir:\n')
  console.log(`  ${result.url}\n`)
  console.log('Linki aç, Google ile gir, profilini tamamla. Yönetici olacaksın.\n')
}

main().finally(() => db.$disconnect())
```

- [ ] **Step 5: Testi çalıştır**

Run: `pnpm vitest run tests/integration/seed.test.ts`
Expected: PASS (3 test)

- [ ] **Step 6: Uçtan uca doğrula**

Boş bir veritabanına karşı `pnpm db:seed` çalıştır, basılan linki tarayıcıda aç, Google ile gir ve `globalRole`'ün `ADMIN` olduğunu veritabanından doğrula. Gerçek Google kimlik bilgisi yoksa bunun yapılamadığını raporda açıkça yaz.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: bootstrap the first admin with a system-issued invite"
```

---

## Plan 1 Tamamlanma Kriteri

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` — hepsi yeşil
- [ ] Davet linkiyle Google üzerinden giriş yapılıp profil kurulabiliyor
- [ ] Kanal açılabiliyor, üye eklenip çıkarılabiliyor, PRIVATE kanal üye olmayana görünmüyor
- [ ] Pasife alınan üyenin oturumu anında düşüyor
- [ ] Uygulama VPS'te domain üzerinden HTTPS ile çalışıyor
- [ ] Yedek alınıyor ve geri yükleme en az bir kez denendi

---

## Sonraki Planlar

| Plan | Kapsam |
|---|---|
| **Plan 2** | Dokümanlar: BlockNote editör, Hocuspocus collab sunucusu ve `onAuthenticate` yetkilendirmesi, `DocumentShare`, yorumlar, mention, Postgres full-text arama, çöp kutusu |
| **Plan 3** | Görevler ve etkinlikler: board + liste, fractional rank sürükle-bırak, takvim, etkinlik-görev bağlantısı, Inbox bildirimleri |
| **Plan 4** | Sponsorlar ve bütçe: durum board'u, `Decimal` para alanları, fiş eki (`Attachment` + dosya yükleme), etkinlik bazlı bütçe kırılımı, ⌘K komut paleti |

Her plan kendi başına çalışan ve test edilebilir yazılım üretir. Plan 2'ye geçmeden önce Plan 1 tamamlanma kriterinin tümü karşılanmalıdır.
