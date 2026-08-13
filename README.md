# MACS

MACS, bir öğrenci kulübünün iç koordinasyonu için kullandığı, kendi sunucusunda
(self-hosted) çalışan bir çalışma alanı uygulamasıdır. Üyeler davet linkiyle
Google üzerinden giriş yapar, kanallara katılır ve içerikleri bu kanallar
altında yönetir: canlı ortak düzenlenen dokümanlar (Yjs + Hocuspocus),
görev panosu, etkinlik takvimi, sponsor takibi, bütçe kalemleri ve fiş
ekleri, yorumlar ve bildirimler. Arama `⌘K` komut paletinden dört içerik
türünde birden yapılır ve her zaman kullanıcının okuma yetkisiyle
sınırlıdır.

**Teknoloji:** Next.js 16 (App Router), React 19, TypeScript (strict),
Tailwind CSS + shadcn/ui, Prisma 6 + Postgres 16, Auth.js v5 (yalnızca Google
sağlayıcısı, veritabanı oturumları), Zod 4, Vitest + Playwright, Docker
Compose + Caddy, GitHub Actions + GHCR.

---

## Yerel geliştirme

**Gereksinimler:** Node 22, pnpm 10.23.0 (`corepack enable` ile gelir),
Docker (yalnızca yerel Postgres için).

> Bu makinede 5432 ve 3000 portları başka bir proje tarafından tutulduğu
> için bu depo bilerek farklı portlar kullanır: **Postgres host portu
> 5433**, **web dev portu 3100**. Container içi portlar (5432, 3000) ve
> CI/production portları bundan etkilenmez.

1. Bağımlılıkları kur:

   ```bash
   pnpm install
   ```

2. Ortam değişkenlerini hazırla — `.env.example`'ı kopyala, gerçek
   değerlerle doldur:

   ```bash
   cp .env.example .env.local
   ```

   `.env.local`'da doldurman gerekenler: `AUTH_SECRET` (`openssl rand -base64
   32`) ve `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` (Google Cloud Console →
   APIs & Services → Credentials → OAuth 2.0 Client ID, tip "Web
   application", yetkili yönlendirme URI'si
   `http://localhost:3100/api/auth/callback/google`). `DATABASE_URL` ve
   `AUTH_URL` zaten dosyada doğru yerel değerlerle geliyor (sırasıyla port
   5433 ve 3100'e işaret eder). `.env.local` gitignore'dadır, asla commit
   edilmez.

3. Yerel Postgres'i ve collab (Hocuspocus) sunucusunu ayağa kaldır — web
   `pnpm dev` ile host'ta çalışır:

   ```bash
   docker compose --env-file .env.local -f compose.dev.yml up -d
   ```

   `--env-file` gerekli: collab servisi web ile AYNI `AUTH_SECRET`'ı
   görmezse doküman websocket'i her bağlantıyı reddeder. Collab'ı
   container yerine host'ta çalıştırmak istersen `pnpm --filter macs-collab
   dev` de aynı işi görür.

4. Şemayı uygula:

   ```bash
   pnpm db:migrate
   ```

5. Geliştirme sunucusunu başlat (http://localhost:3100):

   ```bash
   pnpm dev
   ```

6. İlk kullanıcıyı (kurucu admin) oluştur — bkz. aşağıdaki "İlk admini
   oluşturma" bölümü, yerel ortamda da aynı komut çalışır:

   ```bash
   pnpm db:seed
   ```

   Konsola bir kerelik bir davet linki basılır; onu açıp Google ile giriş
   yaparsan kurucu admin olursun.

### Prisma CLI ve `.env.local`

Prisma CLI kendi başına yalnızca `.env`'i okur, bu depo ise yerel sırları
`.env.local`da tutar; bu yüzden `pnpm db:migrate` / `db:reset` / `db:seed`
"Environment variable not found: DATABASE_URL" ile duruyordu. `prisma.config.ts`
bu dosyaları (önce `.env.local`, sonra `.env`) elle yükler — yeni bir Prisma
komutu eklerken ayrıca bir şey yapmak gerekmez.

### Migration üretirken dikkat: tsvector kolonları

`Document`, `Task`, `Event` ve `Sponsor` tablolarındaki `searchVector`
kolonları **generated tsvector**'lardır ve `schema.prisma`'da tanımlı
değildir (Prisma generated column'ları ifade edemez) — yalnızca migration
dosyalarına elle yazılmış raw SQL ile yaşarlar.

Bunun sonucu: `pnpm db:migrate` her yeni migration'da bu kolonları
"fazlalık" sayıp düşüren ifadeler üretir:

```sql
DROP INDEX "Document_searchVector_idx";
ALTER TABLE "Document" DROP COLUMN "searchVector";
```

**Üretilen migration dosyasından bu ifadeleri her seferinde elle silmek
gerekir.** Bırakılırlarsa arama sessizce çalışmaz olur (`searchDocuments`
"column does not exist" ile patlar). `tests/integration/documents-schema.test.ts`,
`tests/integration/tasks-schema.test.ts` ve
`tests/integration/finance-schema.test.ts` bu kolonların varlığını
doğrular; unutulursa test kırılır.

Ayrıca **uygulanmış bir migration dosyasını sonradan düzenlemek** Prisma'nın
checksum kontrolünü bozar ve `migrate dev` veritabanını sıfırlamak ister.
Bu yüzden yeni tsvector kolonları ayrı bir migration dosyasına yazılır
(ör. `*_tasks_events_search_vectors`, `*_sponsor_search_vector`) — mevcut
bir dosyanın sonuna eklenmez.

### Testler

```bash
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint .
pnpm test         # vitest — unit + integration, gerçek Postgres'e karşı (5433)
pnpm test:watch   # vitest --watch
pnpm build        # next build (standalone çıktı)
pnpm test:e2e     # playwright — build alır, standalone sunucuyu 3100'de başlatır, uçtan uca koşar
```

`pnpm test`, `.env.local`'ı kendiliğinden yükler (`vitest.config.ts`) — Next
zaten `pnpm dev`/`pnpm build` için bunu yapıyordu, vitest için de aynısı
yapılır; elle `export DATABASE_URL=...` gerekmez. Halihazırda ortamda
tanımlı bir değişken varsa (ör. CI'ın kendi `env:` bloğu) dosyadaki değer onu
EZMEZ, yalnızca eksikleri tamamlar.

`pnpm test:e2e` gerçek bir production build'i `pnpm build && pnpm
start:standalone` ile ayağa kaldırıp 3100 portunda test eder — bu portu
`pnpm dev` zaten tutuyorsa önce onu durdur.

Entegrasyon ve E2E testleri paylaşılan yerel Postgres'i (`compose.dev.yml`,
port 5433) kullanır. Vitest tarafı tabloları her testten önce temizler
(`tests/helpers/reset-db.ts`); bu yüzden `vitest.config.ts`'de
`fileParallelism: false` bilinçli olarak kapalıdır (dosyalar arası paralel
çalışma, paylaşılan tabloların sıfırlanmasını birbiriyle yarıştırırdı).

**E2E tarafı temizlemez:** her spec kendi damgalı (`stamp`) kaydını
oluşturur ve veri koşular boyunca birikir. Bu yüzden spec'ler asla "sayfada
tek bir kayıt var" varsayamaz — ör. görev panosu testi panoyu kendi kanalına
filtreli açar, yoksa biriken kartlar sütunu ekran dışına taşırıp sürükleme
hedefini erişilemez kılıyordu. Biriken veriyi temizlemek için
`pnpm db:reset` (yerel geliştirme veritabanını tamamen siler, sonra
`pnpm db:seed`).

---

## Production runbook

Tek bir VPS üzerinde Docker Compose ile self-hosted: `caddy` (reverse proxy +
otomatik HTTPS), `web` (Next.js), `migrate` (kısa ömürlü, şemayı uygulayıp
çıkar), `db` (Postgres 16, yalnızca Docker ağı içinde erişilebilir — host'a
veya internete açık bir portu yok).

### İlk deploy

1. **VPS'i hazırla.** Docker Engine + Compose plugin kurulu bir sunucu (ör.
   Ubuntu). Bu depoyu sunucuda `/opt/macs` altına klonla — `compose.yml`,
   `Caddyfile` ve `scripts/backup.sh` buradan çalışır, `deploy.yml`
   workflow'u da SSH ile bu dizine girip `docker compose` çalıştırır.

   ```bash
   git clone <bu-depo> /opt/macs
   cd /opt/macs
   ```

2. **DNS.** `DOMAIN` için A/AAAA kaydını bu sunucunun IP'sine yönlendir —
   Caddy, `Caddyfile`'daki `{$DOMAIN}` için otomatik TLS sertifikası bu
   kaydın doğru olmasına bağlı çıkarır.

3. **Google OAuth istemcisi.** Google Cloud Console'da bir OAuth 2.0 Client
   ID (Web application) oluştur, yetkili yönlendirme URI'si:
   `https://<DOMAIN>/api/auth/callback/google`.

4. **`/opt/macs/.env` dosyasını oluştur** (bu dosya `.env.local` DEĞİLDİR —
   `docker compose`'un kendi `.env`'i, `.env.example`'ın "Production"
   bölümündeki değişkenleri karşılar; gitignore'da, sunucuda elle doldurulur):

   ```bash
   POSTGRES_PASSWORD=$(openssl rand -base64 24)
   DOMAIN=kulubun-alan-adi.com
   GH_OWNER=<ghcr imajlarını yayınlayan github kullanıcı/organizasyon adı>
   IMAGE_TAG=latest
   AUTH_SECRET=$(openssl rand -base64 32)
   # AUTH_URL mutlaka gerçek https alan adına işaret etmeli — compose.yml
   # bunu web container'ına aynen geçirir ve her davet linki bundan üretilir
   # (src/server/invites.ts). localhost'ta bırakmak her daveti kırar.
   AUTH_URL=https://kulubun-alan-adi.com
   AUTH_GOOGLE_ID=...
   AUTH_GOOGLE_SECRET=...
   ```

5. **GitHub repo secrets'ı ekle** (Settings → Secrets and variables →
   Actions) — `deploy.yml`'in SSH adımı bunları kullanır:
   `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`. `GITHUB_TOKEN` GHCR'a push için
   otomatik sağlanır, ayrıca eklemene gerek yok.

6. **`main`'e push et.** `ci.yml` (tsc, lint, vitest, playwright) geçerse
   `deploy.yml` otomatik tetiklenir (`workflow_run`): `macs-web` ve
   `macs-migrate` imajlarını build edip GHCR'a push eder, sonra SSH ile
   `/opt/macs`'e girip

   ```bash
   docker compose pull web migrate
   docker compose up -d
   ```

   çalıştırır. Compose bağımlılık sırası (`depends_on` + `condition:
   service_completed_successfully`) `db` sağlıklı olduktan sonra `migrate`'i
   çalıştırıp bitirir, ardından `web`'i başlatır; `caddy` `web`'e bağımlıdır
   ve alan adı için sertifikayı ilk istekte otomatik alır.

7. **Doğrula:** `https://<DOMAIN>` açılışta `/login`'e yönlenmeli.

### İlk admini oluşturma (tek seferlik)

Kulüpte henüz hiç kullanıcı yokken `pnpm db:seed`
(`prisma/seed.ts` → `seedBootstrapInvite`), ADMIN yetkili, kanalsız, tek
kullanımlık bir davet üretir ve linkini konsola basar — bu link **bir kez**
gösterilir ve kimse çağırmazsa 7 gün sonra kendiliğinden geçersizleşir. İkinci
bir çalıştırma, sistemde zaten bir kullanıcı ya da bekleyen bir kurulum
daveti varsa hiçbir şey üretmez (bkz. `prisma/seed.ts` içindeki gerekçe) —
yani yanlışlıkla iki kez çalıştırmak güvenlidir.

Şu an image pipeline'ındaki `migrate` imajı bilinçli olarak minimal (yalnızca
`prisma migrate deploy` çalıştıracak kadar — Dockerfile'daki not: "prisma
CLI'ın çalışması için tam node_modules gerekir", ama `src/`'i içermez), bu
yüzden `prisma/seed.ts`'i doğrudan o imajın içinde çalıştıramazsın. `/opt/macs`
sunucuda bu deponun tam bir checkout'u olduğu için (adım 1), en basit yol
projeyi geçici bir Node container'ı içinde, `db` servisiyle aynı Docker ağına
bağlayıp çalıştırmaktır:

```bash
cd /opt/macs
docker run --rm -it \
  --network macs_default \
  -v "$PWD":/repo -w /repo \
  -e DATABASE_URL="postgresql://macs:${POSTGRES_PASSWORD}@db:5432/macs" \
  -e AUTH_URL="https://${DOMAIN}" \
  node:22-alpine \
  sh -c "corepack enable && pnpm install --frozen-lockfile && pnpm exec prisma generate && pnpm db:seed"
```

(`macs_default`, Compose'un `/opt/macs` dizin adından türettiği varsayılan ağ
adıdır; emin değilsen `docker network ls` ile doğrula.) Konsola basılan
linki aç, Google ile giriş yap — kurucu admin olursun ve ilk kanalı kendin
açarsın.

### Yedekleme ve geri yükleme

`scripts/backup.sh` gecelik cron ile çalışacak şekilde yazıldı: veritabanını
`pg_dump` ile, yükleme dizinini (`macs_uploads` volume) `tar` ile alır, ikisini
de `/var/backups/macs`'e sıkıştırır, `rclone` ile offsite bir kopya çıkarır ve
30 günden eski dosyaları budar. Script `docker compose exec` çağırdığı için
**`/opt/macs` dizininden** çalıştırılmalı — crontab girdisi bunu açıkça
sağlamalı:

```cron
0 3 * * * cd /opt/macs && ./scripts/backup.sh >> /var/log/macs-backup.log 2>&1
```

**Geri yükleme** (`STAMP`'i geri yüklemek istediğin yedeğin dosya adındaki
zaman damgasıyla değiştir, `/var/backups/macs/` altında listelenir):

```bash
cd /opt/macs

# Veritabanı
gunzip -c /var/backups/macs/db-<STAMP>.sql.gz | docker compose exec -T db psql -U macs macs

# Yükleme dizini
docker run --rm -v macs_uploads:/data -v /var/backups/macs:/backup alpine \
  tar xzf /backup/uploads-<STAMP>.tar.gz -C /data
```

Offsite kopyalar `rclone`'un `macs-backup:macs/<YIL>-<AY>` uzak konumunda
durur; yerel `/var/backups/macs` kaybolduysa önce oradan indir
(`rclone copy macs-backup:macs/<YIL>-<AY> /var/backups/macs`), sonra yukarıdaki
adımları uygula.

---

## Dizin haritası

```
compose.yml                     prod: caddy + web + migrate + db
compose.dev.yml                 dev: yalnızca db (web host'ta pnpm dev ile)
Caddyfile                       reverse proxy + otomatik HTTPS
Dockerfile                      web/migrate imajları (multi-stage, standalone çıktı)
.env.example                    tüm ortam değişkenleri, gerçek sır yok
.github/workflows/ci.yml        tsc + lint + vitest + playwright
.github/workflows/deploy.yml    imaj build → GHCR → VPS pull
scripts/backup.sh               gecelik yedekleme (db + uploads + offsite)

prisma/schema.prisma            veri modeli
prisma/seed.ts                  ilk admin daveti (bkz. yukarıdaki runbook)

src/lib/auth/policy.ts          can(actor, action, resource) — tek yetki noktası
src/server/*.ts                 server action'lar ('use server')
src/app/                        sayfalar (App Router)

tests/unit/policy.test.ts       yetki matrisi
tests/integration/*.test.ts     gerçek Postgres'e karşı server action testleri
tests/e2e/*.spec.ts             Playwright akışları
```
