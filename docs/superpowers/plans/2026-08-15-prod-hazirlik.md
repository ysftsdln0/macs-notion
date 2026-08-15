# Prod Hazırlığı — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uygulamayı gerçekten çalışan bir production deploy'una hazırlamak — canlı doküman düzenlemeyi kıran iki gizli hatayı kapatmak ve rol sisteminin canlıda rollerle açılmasını sağlamak.

**Architecture:** Collab adresi build zamanı gömülmesinden (`NEXT_PUBLIC_`) çalışma zamanı env'ine taşınır; değer zaten sunucu bileşeninden prop olarak indiği için istemci paketine hiç girmesi gerekmiyordu. Caddy matcher'ı çıplak `/collab` yolunu da eşleyecek şekilde düzeltilir. Sistem rolleri `prisma/seed.ts`'ten alınıp veri migration'ına taşınır, böylece her deploy'da otomatik kurulur ve tanımlar tek yerde durur.

**Tech Stack:** Next.js 16 (standalone output), Prisma 6 + PostgreSQL 16, Docker Compose, Caddy 2, Hocuspocus 2.15.3, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-08-15-prod-hazirlik-design.md](../specs/2026-08-15-prod-hazirlik-design.md)

## Global Constraints

- **`Dockerfile` ve `deploy.yml` DEĞİŞMEZ.** Yaklaşımın asıl kazancı bu: değer build'e gömülmediği için imaj alan adından bağımsız kalır ve aynı `latest` etiketi her sunucuda çalışır. Bir task bu iki dosyayı değiştiriyorsa yanlış yoldadır.
- **Arayüz ve yorum dili Türkçe**, kod tanımlayıcıları İngilizce (repo kuralı).
- **collab workspace ayrı bir CI geçididir** (`.github/workflows/ci.yml:47,51`): `pnpm --filter macs-collab typecheck` ve `pnpm --filter macs-collab test`. Kök `pnpm typecheck` / `pnpm test` `collab/` içine inmez.
- **Migration'lar append-only.** Uygulanmış bir migration dosyası düzenlenirse checksum sapar ve halihazırda göç etmiş her veritabanı `migrate deploy` yapamaz hale gelir.
- **`pnpm test:e2e` çalıştırmadan önce 3100 VE 1234 portları boş olmalı.** `playwright.config.ts` iki webServer tanımlar ve ikisi de `reuseExistingServer: !CI` taşır; artık kalmış bir sunucu sessizce yeniden kullanılır ve testler yanlış veritabanına bakar.
- Komutlar: `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:e2e` · `pnpm --filter macs-collab typecheck` · `pnpm --filter macs-collab test`

---

### Task 1: Collab adresini çalışma zamanına taşı

**Files:**
- Modify: `src/lib/constants.ts`
- Modify: `compose.yml` (`web` servisinin `environment` bloğu)
- Modify: `Caddyfile` (`handle_path` matcher'ı)
- Modify: `.env.example`
- Modify: `playwright.config.ts:23` (`serverEnv`)
- Create: `tests/unit/compose-config.test.ts`

**Interfaces:**
- Produces: `COLLAB_URL` sabiti `src/lib/constants.ts`'ten export edilmeye devam eder, imzası değişmez (`string`). Değişen tek şey hangi env değişkeninden okunduğu.

- [ ] **Step 1: Write the failing test**

`tests/unit/compose-config.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Bu testler uygulamayı değil KONFİGÜRASYONU denetler ve bilerek kaba yazılmıştır.
 *
 * Gerekçesi: collab adresi hatası e2e'nin YAPISAL olarak yakalayamayacağı
 * türdendi. `playwright.config.ts` sunuculara kendi env'ini geçiriyor, yani
 * testte adres her zaman doğru; hata yalnızca gerçek deploy'da görünüyor ve tek
 * belirtisi "editör eşitlenmiyor" oluyor — kimse bunu deploy'a bağlamaz.
 * Değişkenin adı değişirse ya da satır silinirse CI burada düşer.
 */
describe('compose.yml', () => {
  const compose = readFileSync('compose.yml', 'utf8')

  it('web servisine collab adresini geçirir', () => {
    expect(compose).toMatch(/COLLAB_URL:\s*wss:\/\/\$\{DOMAIN\}\/collab/)
  })

  it('istemciye gömülen eski NEXT_PUBLIC_ değişkenini kullanmaz', () => {
    expect(compose).not.toContain('NEXT_PUBLIC_COLLAB_URL')
  })
})

describe('Caddyfile', () => {
  const caddyfile = readFileSync('Caddyfile', 'utf8')

  /**
   * Hocuspocus provider bağlantı adresini `serverUrl` olarak kurar ve sondaki
   * eğik çizgiyi AKTİF OLARAK siler (hocuspocus-provider.cjs:1962-1967);
   * doküman adı yola değil protokol mesajına gider. Yani websocket isteğinin
   * yolu tam olarak `/collab`. `/collab/*` matcher'ı bunu eşlemez ve istek
   * web servisine düşüp 404 alır.
   */
  it('çıplak /collab yolunu da eşler', () => {
    expect(caddyfile).toMatch(/handle_path\s+\/collab\*/)
    expect(caddyfile).not.toMatch(/handle_path\s+\/collab\/\*/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/compose-config.test.ts`
Expected: FAIL — dört testten üçü düşer. `compose.yml`'de `COLLAB_URL` satırı yok ve `Caddyfile` hâlâ `/collab/*` taşıyor. ("eski NEXT_PUBLIC_ değişkenini kullanmaz" testi baştan geçer; `compose.yml`'de zaten yok.)

- [ ] **Step 3: `constants.ts`'te öneki kaldır ve yanlış yorumu düzelt**

`src/lib/constants.ts`:

```ts
export const appName = 'MACS'

/**
 * Hocuspocus websocket adresi.
 *
 * `NEXT_PUBLIC_` öneki BİLEREK yok: değer tarayıcı paketine gömülmüyor.
 * `docs/[id]/page.tsx` bir sunucu bileşeni ve adresi istemci bileşenine prop
 * olarak geçiriyor (`collabUrl={COLLAB_URL}`), yani sunucuda istek anında
 * okunması yeterli. Önek kaldırılınca imaj alan adından bağımsız kalır —
 * aynı imaj her sunucuda çalışır, `Dockerfile`'ın build arg alması gerekmez.
 *
 * Dev'de collab container'ı 1234'ü host'a açar; production'da Caddy `/collab`
 * altında proxy'ler (bkz. Caddyfile ve compose.yml'deki COLLAB_URL).
 */
export const COLLAB_URL = process.env.COLLAB_URL ?? 'ws://localhost:1234'
```

- [ ] **Step 4: `compose.yml`'de `web` servisine değişkeni ekle**

`web` servisinin `environment` bloğunda `AUTH_TRUST_HOST` satırından sonra:

```yaml
      AUTH_TRUST_HOST: 'true'
      # Tarayıcının bağlanacağı collab adresi. Sunucuda okunur ve doküman
      # sayfasından istemciye prop olarak iner — imaja gömülmez, bu yüzden
      # aynı imaj her alan adında çalışır.
      COLLAB_URL: wss://${DOMAIN}/collab
      UPLOAD_DIR: /data/uploads
```

- [ ] **Step 5: `Caddyfile` matcher'ını düzelt**

```
	handle_path /collab* {
		reverse_proxy collab:1234
	}
```

`/collab/*` → `/collab*`. `handle_path` yine `/collab` önekini soyar, ama artık hem çıplak `/collab` hem `/collab/...` eşleşir.

- [ ] **Step 6: `.env.example`'ı güncelle**

`NEXT_PUBLIC_COLLAB_URL` satırını ve üstündeki açıklamayı şununla değiştir:

```
# Collab websocket adresi (Hocuspocus). Sunucuda okunur, doküman sayfasından
# istemciye prop olarak iner — NEXT_PUBLIC_ öneki gerekmez ve BİLEREK yoktur:
# önek imajı build zamanında alan adına çivilerdi. Production'da compose.yml
# bunu `wss://${DOMAIN}/collab` olarak geçirir, Caddy `/collab` altında
# proxy'ler.
COLLAB_URL=ws://localhost:1234
```

- [ ] **Step 7: `playwright.config.ts`'te sunuculara adresi açıkça geçir**

`serverEnv` satırını (23) değiştir:

```ts
// COLLAB_URL açıkça geçirilir: `constants.ts` varsayılanı zaten aynı adres
// olduğu için testler bunsuz da geçerdi, ama o zaman e2e "adres doğru
// yapılandırılmış mı" sorusunu hiç sormamış olurdu. Açık geçmek, değişken
// adı değişirse testlerin de değişmesini zorunlu kılar.
const serverEnv: Record<string, string> = {
  ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
  COLLAB_URL: 'ws://127.0.0.1:1234',
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/compose-config.test.ts`
Expected: PASS — 4 test.

- [ ] **Step 9: Kalan referans kalmadığını doğrula**

Run: `grep -rn "NEXT_PUBLIC_COLLAB_URL" --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.example" . --exclude-dir=node_modules --exclude-dir=.next`
Expected: hiçbir sonuç. Çıktı varsa o dosya da güncellenmeli.

- [ ] **Step 10: Kapıları koştur**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter macs-collab typecheck
pnpm --filter macs-collab test
```
Expected: hepsi temiz.

- [ ] **Step 11: E2E ile canlı eşitlemeyi doğrula**

Önce iki portun da boş olduğunu kontrol et (`lsof -ti:3100`, `lsof -ti:1234` — ikisi de boş çıkmalı), sonra:

Run: `pnpm test:e2e tests/e2e/document-flow.spec.ts`
Expected: PASS — 4 test. Bu, `COLLAB_URL` adının değişmesinin collab bağlantısını kırmadığının kanıtı.

- [ ] **Step 12: Commit**

```bash
git add src/lib/constants.ts compose.yml Caddyfile .env.example playwright.config.ts tests/unit/compose-config.test.ts
git commit -m "fix: wire the collab websocket URL through to production

The URL was read from NEXT_PUBLIC_COLLAB_URL and never passed anywhere — no
build arg, no compose environment — so a deployed browser dialled its own
localhost. The prefix was there on a false premise recorded in the comment:
the value is read in a server component and handed to the client as a prop,
so it never needed to be in the client bundle. Dropping the prefix makes it a
runtime setting and keeps the image domain-agnostic.

The Caddy matcher would not have routed it either. The Hocuspocus provider
strips trailing slashes and puts the document name in the protocol, not the
path, so the socket opens on a bare /collab — which /collab/* does not match.
Each defect hid the other."
```

---

### Task 2: Sistem rollerini veri migration'ına taşı

**Files:**
- Create: `prisma/migrations/<ts>_system_roles/migration.sql`
- Modify: `prisma/schema.prisma` (`Role.position` alanı)
- Modify: `prisma/seed.ts` (`SYSTEM_ROLES` ve `seedSystemRoles` silinir, `main()` sadeleşir)
- Modify: `tests/integration/seed.test.ts` (`seedSystemRoles` bloğu silinir)
- Test: `tests/integration/roles-schema.test.ts` (pozisyon kısıtı testi)

**Interfaces:**
- Consumes: Task 1'den bir şey almaz; bağımsızdır.
- Produces: `prisma/seed.ts` artık yalnızca `seedBootstrapInvite` export eder. `seedSystemRoles` KALDIRILIR — onu çağıran hiçbir kod kalmamalı.

- [ ] **Step 1: Write the failing test**

`tests/integration/roles-schema.test.ts` sonuna ekle:

```ts
// Sıralamayı değiştiren bir arayüz yok; `position` yalnızca rozet sırası.
// Unique kısıt, sabit pozisyonlu sistem rolü eklemeyi (ve e2e'de rastgele
// pozisyon üretmeyi) zorunlu kılıyordu, karşılığında hiçbir şey korumuyordu.
it('iki rol aynı pozisyonu paylaşabilir', async () => {
  await db.role.create({ data: { name: 'Bir', slug: 'bir', position: 1 } })

  await expect(
    db.role.create({ data: { name: 'İki', slug: 'iki', position: 1 } }),
  ).resolves.toMatchObject({ position: 1 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/roles-schema.test.ts`
Expected: FAIL — `Unique constraint failed on the fields: (position)`.

- [ ] **Step 3: Şemadan unique kısıtı kaldır**

`prisma/schema.prisma`, `Role` modelinde:

```prisma
  // Yalnızca rozet sıralaması için. Yetki hiyerarşisi DEĞİL — rol
  // düzenleyebilen tek aktör (SUPERADMIN) zaten her izne sahip. Unique
  // DEĞİL: sabit pozisyonlu sistem rolü eklemeyi engelliyor ve sıralamayı
  // değiştiren bir arayüz olmadığı için hiçbir şey korumuyordu.
  position    Int
```

- [ ] **Step 4: Migration'ı üret ve sistem rollerini ekle**

```bash
pnpm prisma migrate dev --create-only --name system_roles
```

Üretilen `migration.sql` unique index'i düşüren satırı içerecek. Dosyanın sonuna sistem rollerinin eklenmesini ekle; tam içerik:

```sql
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
```

> `Role.id` şemada `cuid()` varsayılanı taşır ama Postgres cuid üretemez; sabit ve okunabilir literal id'ler kullanılır. Tip `String` olduğu için herhangi bir tekil dize geçerlidir.

Uygula:

```bash
pnpm prisma migrate dev
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/roles-schema.test.ts`
Expected: PASS.

- [ ] **Step 6: `seed.ts`'ten sistem rollerini sil**

`prisma/seed.ts`'te şunları KALDIR:
- `SYSTEM_ROLES` sabiti (satır 21 civarı) ve üstündeki açıklama bloğu
- `seedSystemRoles` fonksiyonu (satır 55 civarı) ve üstündeki açıklama bloğu

`main()` içinden de çağrıyı ve log satırını çıkar; geriye şu kalır:

```ts
async function main() {
  const result = await seedBootstrapInvite()
  if (!result.ok) {
    console.log(result.reason)
    return
  }
  console.log('\nKurulum daveti üretildi. Bu link bir kez gösterilir:\n')
  console.log(`  ${result.url}\n`)
  console.log('Linki aç, Google ile gir, profilini tamamla. Sistem sahibi olacaksın.\n')
}
```

`seedBootstrapInvite`'ın üstündeki açıklama bloğunda sistem rollerinden söz eden bir cümle varsa çıkar — roller artık migration'ın işi.

- [ ] **Step 7: `seedSystemRoles` testlerini sil**

`tests/integration/seed.test.ts`'teki `describe('seedSystemRoles', () => { … })` bloğunun tamamını (satır 68'den bloğun sonuna) sil. Dosyanın en üstündeki import'tan da `seedSystemRoles`'ü çıkar:

```ts
import { seedBootstrapInvite } from '../../prisma/seed'
```

- [ ] **Step 8: Çağıran kalmadığını doğrula**

Run: `grep -rn "seedSystemRoles" --include="*.ts" . --exclude-dir=node_modules`
Expected: hiçbir sonuç.

- [ ] **Step 9: Kapıları koştur**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter macs-collab typecheck
pnpm --filter macs-collab test
```
Expected: hepsi temiz. `pnpm test` içindeki `roles.test.ts` ve `roles-visibility.test.ts` kendi rollerini oluşturduğu için migration'daki rollerden etkilenmez (`resetDb()` her testten önce tüm tabloları boşaltır).

- [ ] **Step 10: Migration'ın gerçekten rol ürettiğini elle doğrula**

```bash
pnpm prisma studio
```

`Role` tablosunda üç sistem rolü görünmeli (`isSystem: true`). Studio'yu kapat.

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma prisma/migrations prisma/seed.ts tests/integration/seed.test.ts tests/integration/roles-schema.test.ts
git commit -m "feat: create system roles from a migration instead of the seed

compose.yml runs migrate on every deploy but never seeds, so a deployment came
up with no roles at all — the role panel opened onto an empty list. Moving the
three system roles into a data migration makes them appear automatically,
using the same mechanism the two superadmin promotions already use.

The TypeScript copy is deleted rather than kept alongside: role definitions in
both SQL and TS would drift. The bootstrap invite stays a manual step on
purpose — it prints a single-use owner credential to stdout, which has no
business in deploy logs.

Also drops the unique constraint on Role.position, which blocked the
fixed-position insert and which the branch review had already flagged as
guarding nothing: there is no reordering UI, and the e2e spec was working
around it with a random position."
```

---

### Task 3: Deploy belgelerini gerçekle hizala

**Files:**
- Modify: `README.md` (deploy bölümü, satır 177-270 civarı)

**Interfaces:**
- Consumes: Task 1 ve Task 2'nin sonuçları — belgeler onları anlatır.
- Produces: Yok (yalnızca belge).

- [ ] **Step 1: Servis listesine collab'ı ekle**

README'nin deploy bölümü açılışındaki servis cümlesi `collab`'ı saymıyor. `compose.yml`'deki gerçek listeyle hizala:

```
Tek bir VPS üzerinde Docker Compose ile self-hosted: `caddy` (reverse proxy +
otomatik HTTPS), `web` (Next.js), `collab` (Hocuspocus — canlı doküman
düzenleme, Caddy `/collab` altında proxy'ler), `migrate` (kısa ömürlü, şemayı
uygulayıp çıkar), `db` (Postgres 16, yalnızca Docker ağı içinde erişilebilir —
host'a veya internete açık bir portu yok).
```

- [ ] **Step 2: "İlk admini oluşturma" bölümünü düzelt**

Başlığı ve ilk paragrafı değiştir — davet artık `SUPERADMIN` yetkili ve bunun neden önemli olduğu yazılmalı:

```markdown
### İlk sistem sahibini oluşturma (tek seferlik)

Kulüpte henüz hiç kullanıcı yokken `pnpm db:seed` (`prisma/seed.ts` →
`seedBootstrapInvite`), **SUPERADMIN** yetkili, kanalsız, tek kullanımlık bir
davet üretir ve linkini konsola basar — bu link **bir kez** gösterilir ve kimse
çağırmazsa 7 gün sonra kendiliğinden geçersizleşir. İkinci bir çalıştırma,
sistemde zaten bir kullanıcı ya da bekleyen bir kurulum daveti varsa hiçbir şey
üretmez, yani yanlışlıkla iki kez çalıştırmak güvenlidir.

Kademe ADMIN değil SUPERADMIN, çünkü rol paneli (`/admin/roles`) ve kademe
dağıtma yetkisi o kapının arkasındadır: ADMIN yetkili bir kurulum daveti,
kimsenin rolleri yönetemediği bir sistem kurardı.

**Sistem rolleri seed'den gelmez** — `Yönetim Kurulu`, `Genel Sekreter` ve
`İnsan Kaynakları` bir veri migration'ıyla oluşur, yani `migrate` job'ı her
deploy'da onları hazır eder. `pnpm db:seed` yalnızca kurulum davetini üretir.
```

- [ ] **Step 3: Doğrulama adımını genişlet**

Mevcut "7. **Doğrula:**" maddesini şununla değiştir:

```markdown
7. **Doğrula:**
   - `https://<DOMAIN>` açılışta `/login`'e yönlenmeli
   - `docker compose ps` — `caddy`, `web`, `collab`, `db` hepsi `Up`, `migrate`
     `Exited (0)`
   - Sistem sahibi olarak girdikten sonra `/admin` → **Roller** bölümünde üç
     sistem rolü listelenmeli
   - **Bir doküman aç ve ikinci bir sekmede aynı dokümanı aç: yazdığın satır
     karşı sekmede anında görünmeli.** Bu, collab zincirinin (COLLAB_URL →
     Caddy `/collab` → Hocuspocus) uçtan uca çalıştığının tek gerçek kanıtıdır;
     kırık olsaydı editör sessizce yerel kalırdı.
```

- [ ] **Step 4: Belgelerin koda uyduğunu doğrula**

Run: `grep -n "NEXT_PUBLIC_COLLAB_URL\|ADMIN yetkili\|seedSystemRoles" README.md`
Expected: hiçbir sonuç.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: align the deploy guide with how the system actually boots

The service list omitted collab, the bootstrap section still described an
ADMIN-tier invite, and nothing told the operator that system roles now arrive
with the migration rather than the seed. Adds the two-tab document check to the
verification list — it is the only step that proves the collab chain works end
to end, and the failure mode is silent."
```

---

### Task 4: İlk canlı deploy

**Files:** Yok — bu task sunucuda ve GitHub'da çalışır, repoda değişiklik üretmez.

**Interfaces:**
- Consumes: Task 1-3'ün `main`'e birleşmiş hali.

> Bu task'ın adımlarını **repo sahibi** yürütür; uygulayıcı yalnızca yönlendirir ve çıktıları doğrular. Sırayı bozma: her adım bir öncekinin doğrulanmasına dayanıyor.

- [ ] **Step 1: GitHub secrets'ı ekle**

Depo → Settings → Secrets and variables → Actions → New repository secret:

| Ad | Değer |
|---|---|
| `VPS_HOST` | Sunucunun IP'si veya hostname'i |
| `VPS_USER` | SSH kullanıcısı (ör. `root` ya da deploy kullanıcısı) |
| `VPS_SSH_KEY` | O kullanıcının **özel** anahtarı, tam içerik (`-----BEGIN ... KEY-----` satırları dahil) |

`GITHUB_TOKEN` otomatik sağlanır, eklenmez.

- [ ] **Step 2: Sunucuda depoyu ve `.env`'i hazırla**

```bash
git clone <depo-url> /opt/macs
cd /opt/macs
```

`/opt/macs/.env` oluştur (`.env.local` DEĞİL — Compose'un kendi `.env`'i):

```bash
POSTGRES_PASSWORD=<openssl rand -base64 24 çıktısı>
DOMAIN=<alan adı>
GH_OWNER=<ghcr imajlarını yayınlayan github kullanıcı/organizasyon>
IMAGE_TAG=latest
AUTH_SECRET=<openssl rand -base64 32 çıktısı>
AUTH_URL=https://<alan adı>
AUTH_GOOGLE_ID=<Google OAuth client id>
AUTH_GOOGLE_SECRET=<Google OAuth client secret>
```

`AUTH_URL` gerçek https alan adına işaret etmeli: her davet linki bundan üretilir (`src/server/invites.ts`), localhost bırakılırsa her davet kırılır.

Doğrula:

```bash
docker compose config
```
Expected: hatasız çıktı, `web` servisinin ortamında `COLLAB_URL: wss://<alan adı>/collab` görünür. Görünmüyorsa `.env`'deki `DOMAIN` boştur.

- [ ] **Step 3: `main`'e push et ve pipeline'ı izle**

Task 1-3 `main`'de olmalı. GitHub → Actions:
- `CI` yeşil (tsc, lint, vitest, playwright, collab typecheck+test)
- ardından `Deploy` tetiklenir ve üç imajı GHCR'a push eder, sonra SSH ile `/opt/macs`'te compose'u günceller

Expected: her iki workflow da yeşil. `Deploy` SSH adımında düşerse Step 1'deki secret'lar eksik ya da yanlıştır.

- [ ] **Step 4: Servislerin ayakta olduğunu doğrula**

Sunucuda:

```bash
cd /opt/macs
docker compose ps
```
Expected: `caddy`, `web`, `collab`, `db` → `Up`; `migrate` → `Exited (0)`.

`migrate` sıfırdan farklı bir kodla çıktıysa logunu oku (`docker compose logs migrate`) ve devam etme — şema uygulanmadıysa uygulama çalışmaz.

- [ ] **Step 5: TLS ve giriş sayfasını doğrula**

Tarayıcıda `https://<alan adı>` — sertifika geçerli olmalı ve `/login`'e yönlenmeli.

Sertifika alınamıyorsa DNS A/AAAA kaydı bu sunucuyu göstermiyordur; `docker compose logs caddy` bunu açıkça yazar.

- [ ] **Step 6: Sistem rollerinin oluştuğunu doğrula**

```bash
cd /opt/macs
docker compose exec db psql -U macs -d macs -c 'SELECT slug, position, "isSystem" FROM "Role" ORDER BY position;'
```
Expected: üç satır — `yonetim-kurulu`, `genel-sekreter`, `insan-kaynaklari`, hepsi `isSystem = t`.

Tablo boşsa migration çalışmamıştır; Step 4'e dön.

- [ ] **Step 7: Kurulum davetini üret (tek seferlik)**

```bash
cd /opt/macs
source .env
docker run --rm -it \
  --network macs_default \
  -v "$PWD":/repo -w /repo \
  -e DATABASE_URL="postgresql://macs:${POSTGRES_PASSWORD}@db:5432/macs" \
  -e AUTH_URL="https://${DOMAIN}" \
  node:22-alpine \
  sh -c "corepack enable && pnpm install --frozen-lockfile && pnpm exec prisma generate && pnpm db:seed"
```

Expected: konsola tek kullanımlık bir davet linki basılır. **Bu link bir kez gösterilir** — hemen kopyala.

Ağ adı `macs_default` Compose'un `/opt/macs` dizin adından türettiği varsayılandır; farklıysa `docker network ls` ile doğrula.

- [ ] **Step 8: Sistem sahibi olarak gir**

Linki tarayıcıda aç, Google ile gir, profili tamamla.

Doğrula: `/members` sayfasında kendi satırında **Sistem sahibi** rozeti görünmeli. Görünmüyorsa davet kademesi yanlış uygulanmıştır — devam etme.

- [ ] **Step 9: Rol panelini doğrula**

`/admin` → **Roller** bölümü görünmeli → "Rolleri yönet" → üç sistem rolü listede, her birinin izin sayısı yazılı.

Bir role gir, bir izin kutucuğunu değiştir, Kaydet, sayfayı yenile — değişiklik kalmalı.

- [ ] **Step 10: Collab zincirini doğrula — bu task'ın asıl sınavı**

Bir doküman oluştur. Aynı dokümanı ikinci bir sekmede aç. Bir sekmede yaz.

Expected: yazdığın satır karşı sekmede **anında** görünür.

Görünmüyorsa tarayıcı konsolunda websocket hatasına bak:
- `wss://<alan adı>/collab` 404 veriyorsa → `Caddyfile` matcher'ı `/collab*` değil
- `ws://localhost:1234`'e bağlanmaya çalışıyorsa → `COLLAB_URL` web container'ına geçmemiş (`docker compose config` ile doğrula)
- Bağlanıp hemen kopuyorsa → `AUTH_SECRET` web ve collab container'larında farklı

- [ ] **Step 11: Gecelik yedeklemeyi kur**

```bash
crontab -e
```

Ekle:

```
0 3 * * * cd /opt/macs && ./scripts/backup.sh >> /var/log/macs-backup.log 2>&1
```

`scripts/backup.sh` `/opt/macs` dizininden çalıştırılmak üzere yazıldı; `cd` şart.

Ertesi gün doğrula: `/var/backups/macs` altında `db-*.sql.gz` ve `uploads-*.tar.gz` oluşmuş olmalı.

---

## Uygulama sonrası kontrol listesi

- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:e2e` · collab'ın iki komutu — hepsi temiz
- [ ] `grep -rn "NEXT_PUBLIC_COLLAB_URL" --include="*.ts" --include="*.tsx" --include="*.yml" . --exclude-dir=node_modules` boş
- [ ] `grep -rn "seedSystemRoles" --include="*.ts" . --exclude-dir=node_modules` boş
- [ ] Canlıda iki sekmede doküman eşitlemesi çalışıyor
- [ ] `/admin/roles` üç sistem rolünü gösteriyor
- [ ] Gecelik yedekleme cron'u kurulu ve ilk çıktısını üretti
