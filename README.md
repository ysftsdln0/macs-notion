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
Compose (Plesk nginx arkasında), GitHub Actions + GHCR.

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

6. İlk kullanıcıyı (sistem sahibi) oluştur — bkz. aşağıdaki "İlk sistem sahibini
   oluşturma" bölümü, yerel ortamda da aynı komut çalışır:

   ```bash
   pnpm db:seed
   ```

   Konsola bir kerelik bir davet linki basılır; onu açıp Google ile giriş
   yaparsan sistem sahibi (SUPERADMIN) olursun.

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

**Testler AYRI bir veritabanı kullanır.** Aynı Postgres örneği
(`compose.dev.yml`, port 5433) ama veritabanı adı `_test` ekiyle değişir:
geliştirme `macs`, testler `macs_test`. Dönüşümü
`tests/helpers/test-database-url.ts` yapar; vitest, collab vitest ve
Playwright config'leri bunu çağırır, Playwright ayrıca `DATABASE_URL`i
başlattığı web ve collab sunucularına açıkça geçirir. Şema
`prisma migrate deploy` ile global setup'ta uygulanır — veritabanı yoksa
oluşturulur, ekstra bir kurulum adımı yoktur.

> Bu ayrım şart: `resetDb` her testten önce BÜTÜN tabloları boşaltıyor.
> Test veritabanı ayrılmadan önce `pnpm test`, geliştirme veritabanındaki
> gerçek hesabı da siliyordu (`User` → `Account`/`Session` cascade) ve
> geliştirici bir sonraki girişte "hesabın devre dışı bırakılmış ya da
> geçerli bir davet linkin yok" hatasını alıyordu — Auth.js, kullanıcı
> satırı olmayan ve davet çerezi de taşımayan bir girişi `AccessDenied`
> ile reddediyor.

`vitest.config.ts`'de `fileParallelism: false` bilinçli olarak kapalıdır:
dosyalar arası paralel çalışma, paylaşılan tabloların sıfırlanmasını
birbiriyle yarıştırırdı.

`resetDb` elle yazılmış bir silme SIRASI tutmaz; bütün tabloları tek bir
ifadede (veri değiştiren CTE'ler) boşaltır, foreign key kontrolleri ifadenin
sonunda yapılır. Yeni bir model eklerken orada yapılacak bir şey yoktur.

**E2E tarafı temizlemez:** her spec kendi damgalı (`stamp`) kaydını
oluşturur ve veri koşular boyunca `macs_test` içinde birikir. Bu yüzden
spec'ler asla "sayfada tek bir kayıt var" varsayamaz — ör. görev panosu
testi panoyu kendi kanalına filtreli açar, yoksa biriken kartlar sütunu
ekran dışına taşırıp sürükleme hedefini erişilemez kılıyordu.

---

## Production runbook

Sunucuda **Plesk** kurulu ve 80/443'ü onun nginx'i tutuyor; TLS sertifikasını da
Plesk yönetiyor. Docker tarafı bu yüzden yalnızca uygulamayı çalıştırır ve
konteynerlerini **sadece `127.0.0.1`'e** açar — internete açık tek kapı Plesk'tir.

Servisler: `web` (Next.js, `127.0.0.1:3100`), `collab` (Hocuspocus — canlı
doküman düzenleme, `127.0.0.1:1234`), `migrate` (kısa ömürlü, şemayı uygulayıp
çıkar), `db` (Postgres 16, host'a hiç port açmaz).

Trafik: `tarayıcı → Plesk nginx (TLS) → 127.0.0.1:3100` ve `/collab` için
`→ 127.0.0.1:1234`. Proxy yönergeleri depoda: `deploy/plesk-nginx.conf`.

### İlk deploy

1. **Sunucuyu hazırla.** Docker Engine + Compose plugin kurulu, Plesk'li bir
   sunucu. Bu depoyu `/opt/macs` altına klonla — `compose.yml` ve
   `scripts/backup.sh` buradan çalışır, `deploy.yml` workflow'u da SSH ile bu
   dizine girip `docker compose` çalıştırır.

   ```bash
   git clone <bu-depo> /opt/macs
   cd /opt/macs
   ```

2. **Plesk'te alan adı.** Alan adı Plesk'te tanımlı ve Let's Encrypt
   sertifikası alınmış olmalı (Plesk panel → SSL/TLS Sertifikaları). DNS
   A/AAAA kaydı bu sunucuyu göstermeli — sertifika buna bağlı çıkar.

3. **Google OAuth istemcisi.** Google Cloud Console'da bir OAuth 2.0 Client
   ID (Web application) oluştur, yetkili yönlendirme URI'si:
   `https://<DOMAIN>/api/auth/callback/google`.

4. **`/opt/macs/.env` dosyasını oluştur** (bu dosya `.env.local` DEĞİLDİR —
   `docker compose`'un kendi `.env`'i, `.env.example`'ın "Production"
   bölümündeki değişkenleri karşılar; gitignore'da, sunucuda elle doldurulur).

   Önce iki sırrı üret ve çıktılarını not al:

   ```bash
   openssl rand -hex 24      # POSTGRES_PASSWORD için
   openssl rand -base64 32   # AUTH_SECRET için
   ```

   Şifrede `-hex`, sırda `-base64`: ikisi de aynı entropiyi verir ama
   `compose.yml` şifreyi bir URL'in içine gömüyor
   (`postgresql://macs:${POSTGRES_PASSWORD}@db:5432/macs`) ve base64
   alfabesindeki `/` orada geçersiz — ayrıştırıcı kalanını yol sanar,
   `migrate` bağlanamaz, `web` hiç başlamaz. 32 karakterlik bir base64
   dizesinde en az bir `/` çıkma olasılığı yaklaşık %40, yani hata
   "bazen" ortaya çıkar ve `.env`'e bakan biri sorunu göremez. `AUTH_SECRET`
   hiçbir URL'e girmediği için bu kısıt onda yok.

   Sonra dosyayı, HER satırı literal metin olacak şekilde doldur — Compose
   `.env` dosyasında `$(...)` gibi bir kabuk ifadesini ÇALIŞTIRMAZ, olduğu
   gibi değer sayar: `POSTGRES_PASSWORD=$(openssl rand -base64 24)` yazarsan
   Postgres'in şifresi harfiyen o dize olur, `DATABASE_URL` ayrıştırılamaz,
   `migrate` başarısız çıkar, `web` hiç başlamaz ve kurtarma veritabanı
   volume'unu (`docker compose down -v`) silmeyi gerektirir:

   ```bash
   POSTGRES_PASSWORD=<yukarıdaki ilk openssl çıktısı>
   DOMAIN=kulubun-alan-adi.com
   GH_OWNER=<ghcr imajlarını yayınlayan github kullanıcı/organizasyon adı>
   IMAGE_TAG=latest
   AUTH_SECRET=<yukarıdaki ikinci openssl çıktısı>
   # AUTH_URL mutlaka gerçek https alan adına işaret etmeli — compose.yml
   # bunu web container'ına aynen geçirir ve her davet linki bundan üretilir
   # (src/server/invites.ts). localhost'ta bırakmak her daveti kırar.
   AUTH_URL=https://kulubun-alan-adi.com
   AUTH_GOOGLE_ID=...
   AUTH_GOOGLE_SECRET=...
   ```

5. **GitHub repo secrets'ı ekle** (Settings → Secrets and variables →
   Actions → **Repository secrets**) — `deploy.yml`'in SSH adımı bunları
   kullanır: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PORT`.
   `GITHUB_TOKEN` GHCR'a push için otomatik sağlanır, ayrıca eklemene gerek
   yok.

   Aynı sayfadaki **Environment** secret'ları BURAYA UYMAZ: bir job onları
   ancak `environment:` anahtarını bildirirse görür, `deploy.yml`'de öyle bir
   satır yok. Yanlışlıkla oraya girilirse `${{ secrets.VPS_HOST }}` boş string
   olur ve SSH adımı, üç imaj başarıyla push edildikten sonra hiçbir şey
   söylemeden düşer.

   `VPS_SSH_KEY` **parolasız** bir private key'in tamamıdır —
   `-----BEGIN OPENSSH PRIVATE KEY-----` ve `-----END ...` satırları dahil,
   `.pub` dosyası değil; public kısmı sunucuda `~/.ssh/authorized_keys`
   içinde olmalı. `VPS_PORT` sshd'nin gerçekten dinlediği porttur
   (`ss -tlnp | grep sshd`); 22 bile olsa açıkça yazılır.

6. **`main`'e push et.** `ci.yml` (tsc, lint, vitest, playwright) geçerse
   `deploy.yml` otomatik tetiklenir (`workflow_run`): `macs-web`,
   `macs-migrate` ve `macs-collab` imajlarını build edip GHCR'a push eder,
   sonra SSH ile `/opt/macs`'e girip

   ```bash
   set -e
   git pull
   docker compose pull web migrate collab
   docker compose up -d
   docker image prune -f
   ```

   çalıştırır. `git pull` şart: `compose.yml` imajların İÇİNDE değil bu
   sunucudaki git checkout'ta yaşıyor (adım 1) — atlanırsa yeni imajlar eski
   konfigürasyonla ayağa kalkar ve deploy yeşil geçtiği halde değişiklik
   sunucuya ulaşmaz. `set -e` de şart: çok satırlı uzak script'in çıkış kodu
   son komutunkidir (`docker image prune -f`, pratikte hep 0), yani onsuz
   düşen bir `git pull` bile deploy'u yeşil gösterirdi.

   Compose bağımlılık sırası (`depends_on` + `condition:
   service_completed_successfully`) `db` sağlıklı olduktan sonra `migrate`'i
   çalıştırıp bitirir, ardından `web` ve `collab`'ı başlatır.

   **Plesk tarafı bu script'e dahil değildir.** `deploy/plesk-nginx.conf`
   değişirse Plesk panelinden elle güncellenmelidir (bkz. adım 6).

6. **Plesk'i uygulamaya yönlendir.** Plesk panel → alan adı → **Apache & nginx
   Ayarları**.

   Yapıştırmadan ÖNCE aynı sayfadaki **"Proxy mode"** ve **"Smart static files
   processing"** kutularını kapat. Açık kaldıklarında Plesk kendi `location /`
   bloğunu üretir ve dosyadaki blokla çakışır; kaydetmeye çalışınca panel
   `nginx: [emerg] duplicate location "/"` der ve yönergeleri hiç kabul etmez.
   Bu alan adında Apache/PHP devre dışı kalır — tek iş Node uygulamasını
   proxy'lemek olduğu için istenen de budur.

   Sonra "Ek nginx yönergeleri" alanına `deploy/plesk-nginx.conf` dosyasının
   tamamını yapıştır ve kaydet. Plesk nginx'i kendisi yeniden yükler.

   Dosya iki şey yapar: kökü `127.0.0.1:3100`'e (uygulama), `/collab` yolunu
   `127.0.0.1:1234`'e (Hocuspocus) proxy'ler. `/collab` bloğundaki
   `Upgrade`/`Connection` başlıkları **atlanamaz** — onlarsız nginx websocket
   yükseltmesini geçirmez, sayfa ve editör açılır ama hiçbir şey eşitlenmez ve
   hiçbir yerde hata görünmez.

7. **Altyapıyı doğrula:**
   - `https://<DOMAIN>` açılışta `/login`'e yönlenmeli
   - `docker compose ps` — `web`, `collab`, `db` hepsi `Up`, `migrate`
     `Exited (0)`
   - `curl -sI http://127.0.0.1:3100` sunucuda 200 ya da 307 dönmeli (Plesk
     devrede olmasa bile uygulamanın ayakta olduğunu ayırt eder)

   İlk sistem sahibini oluşturduktan sonra (bkz. aşağıdaki bölüm), ek doğrulamalar:
   - `/admin/roles` sayfasında (`/admin` → **Roller** → "Rolleri yönet") üç
     sistem rolü listelenmeli: `Yönetim Kurulu`, `Genel Sekreter`,
     `İnsan Kaynakları`
   - Bir doküman oluştur, ikinci sekmede aynı dokümanı aç: yazdığın satır anında
     görünmeli — collab zinciri (COLLAB_URL → Plesk nginx `/collab` →
     Hocuspocus) uçtan uca çalışıyor.

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

Şu an image pipeline'ındaki `migrate` imajı bilinçli olarak minimal (yalnızca
`prisma migrate deploy` çalıştıracak kadar — Dockerfile'daki not: "prisma
CLI'ın çalışması için tam node_modules gerekir", ama `src/`'i içermez), bu
yüzden `prisma/seed.ts`'i doğrudan o imajın içinde çalıştıramazsın. `/opt/macs`
sunucuda bu deponun tam bir checkout'u olduğu için (adım 1), en basit yol
projeyi geçici bir Node container'ı içinde, `db` servisiyle aynı Docker ağına
bağlayıp çalıştırmaktır:

Aşağıdaki komut `.env`'deki iki değeri kullanır, ama `docker run` `.env`'i
kendiliğinden okumaz — değerleri önce kabuğa almak gerekir:

```bash
cd /opt/macs
POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
DOMAIN=$(grep -m1 '^DOMAIN=' .env | cut -d= -f2-)
```

`set -a; . ./.env; set +a` yerine bilerek `grep`: sourcing bu değerleri
kabuğa EXPORT eder ve Compose'un öncelik sırasında kabuk ortamı `.env`
dosyasının önünde gelir. O kabukta sonradan `.env`'i düzeltip
`docker compose up -d --force-recreate` çalıştırdığında container eski,
export edilmiş değeri alır — dosya doğru göründüğü halde uygulama yanlış
değerle ayağa kalkar (ör. yanlış `AUTH_GOOGLE_ID` ile Google `invalid_client`
döner). Yukarıdaki iki satır export etmez, o tuzağı hiç kurmaz.

```bash
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
linki aç, Google ile giriş yap — sistem sahibi olursun ve ilk kanalı kendin
açarsın. Girdikten sonra, yukarıdaki "Altyapıyı doğrula" bölümündeki
ek doğrulama adımlarını tamamla (roller panel ve iki sekmeli doküman testi).

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
compose.yml                     prod: web + collab + migrate + db (127.0.0.1'e)
compose.dev.yml                 dev: db + collab (web host'ta pnpm dev ile)
deploy/plesk-nginx.conf         Plesk'e yapıştırılan proxy yönergeleri
Dockerfile                      web/migrate imajları (multi-stage, standalone çıktı)
.env.example                    tüm ortam değişkenleri, gerçek sır yok
.github/workflows/ci.yml        tsc + lint + vitest + playwright
.github/workflows/deploy.yml    imaj build → GHCR → VPS pull
scripts/backup.sh               gecelik yedekleme (db + uploads + offsite)

prisma/schema.prisma            veri modeli
prisma/seed.ts                  ilk sistem sahibi daveti (bkz. yukarıdaki runbook)

src/lib/auth/policy.ts          can(actor, action, resource) — tek yetki noktası
src/server/*.ts                 server action'lar ('use server')
src/app/                        sayfalar (App Router)

tests/unit/policy.test.ts       yetki matrisi
tests/integration/*.test.ts     gerçek Postgres'e karşı server action testleri
tests/e2e/*.spec.ts             Playwright akışları
```
