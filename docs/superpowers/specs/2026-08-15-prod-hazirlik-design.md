# Prod Hazırlığı — Tasarım

**Tarih:** 2026-08-15
**Durum:** Onaylandı
**İlgili:** [2026-08-13-roller-ve-izinler-design.md](./2026-08-13-roller-ve-izinler-design.md)

## Problem

Deploy altyapısı hazır: `Dockerfile` (web + migrate hedefleri), `collab/Dockerfile`,
`compose.yml` (caddy · web · collab · migrate · db), `Caddyfile`, GHCR'a build eden
ve VPS'e SSH ile giren `deploy.yml`, gecelik `scripts/backup.sh`, ve README'de
adım adım bir ilk-deploy bölümü. Sunucu tarafında Docker, DNS ve Google OAuth
istemcisi de hazır.

Buna rağmen sistem bugün canlıya alınırsa kırık gelir: canlı doküman düzenleme iki
ayrı sebepten çalışmaz, ve rol sistemi hiç rolle açılmaz.

### 1. Canlı doküman düzenleme çalışmaz

`src/lib/constants.ts` collab adresini `NEXT_PUBLIC_COLLAB_URL`'den okuyor ve
varsayılanı `ws://localhost:1234`. Bu değişken hiçbir yerde build'e ya da
çalışma zamanına geçmiyor: `Dockerfile`'da build arg yok, `compose.yml`'in `web`
servisinde env yok. Sonuç: canlıda her kullanıcının tarayıcısı **kendi
localhost'una** bağlanmaya çalışır. Caddy'de `/collab/*` yolu hazır ama kimse
istemciye o adresi söylemiyor.

Değişkenin hiç bağlanmamış olmasının sebebi `constants.ts`'teki yorumda yazılı
ve o yorum **yanlış**: "Tarayıcıya gömüldüğü için `NEXT_PUBLIC_` öneki zorunlu".
Değer tarayıcıya gömülmüyor — `docs/[id]/page.tsx` bir sunucu bileşeni ve değeri
istemci bileşenine **prop olarak** geçiriyor (`collabUrl={COLLAB_URL}`).

**E2E bunu yakalayamaz.** `playwright.config.ts` sunuculara kendi env'ini
geçiriyor ve testte adres doğru. Hata yalnızca gerçek deploy'da görünür, tek
belirtisi de "editör eşitlenmiyor" olur.

### 2. Canlıda hiç rol olmaz

`compose.yml`'de `migrate` job'ı var ama seed yok. `seedSystemRoles`
(`prisma/seed.ts`) yalnızca `pnpm db:seed` ile çalışır, o da elle atılan bir
adım. Rol sistemi sıfır rolle açılır.

## Çözüm A — collab adresi çalışma zamanına taşınır

```ts
// src/lib/constants.ts
export const COLLAB_URL = process.env.COLLAB_URL ?? 'ws://localhost:1234'
```

`NEXT_PUBLIC_` öneki düşer. Değer sunucuda istek anında okunur ve zaten prop
olarak iniyor, dolayısıyla istemci paketine girmesine gerek yok.

Dokunulan yerler:

| Dosya | Değişiklik |
|---|---|
| `src/lib/constants.ts` | Önek kaldırılır, yanlış yorum düzeltilir |
| `compose.yml` | `web` servisine `COLLAB_URL: wss://${DOMAIN}/collab` |
| `Caddyfile` | `handle_path /collab/*` → `handle_path /collab*` (aşağıya bak) |
| `.env.example` | Değişken adı ve prod karşılığı |
| `playwright.config.ts` | `serverEnv`'e `COLLAB_URL` (şu an varsayılana düşüp tesadüfen doğru) |

### Caddy matcher'ı da yanlış

Adres doğru geçirilse bile Caddy isteği collab'a yönlendirmezdi. `@hocuspocus/provider`
2.15.3, `hocuspocus-provider.cjs:1962-1971`'de bağlantı adresini şöyle kuruyor:

```js
// Ensure that the URL always ends with /
get serverUrl() {
  while (this.configuration.url[this.configuration.url.length - 1] === '/') {
    return this.configuration.url.slice(0, this.configuration.url.length - 1)
  }
  return this.configuration.url
}
get url() {
  const encodedParams = encodeQueryParams(this.configuration.parameters)
  return `${this.serverUrl}${encodedParams.length === 0 ? '' : `?${encodedParams}`}`
}
```

Doküman adı yola eklenmiyor (protokol mesajında gidiyor) ve sondaki eğik çizgi
**aktif olarak siliniyor**. Yani websocket isteğinin yolu tam olarak `/collab`.

`Caddyfile`'daki `handle_path /collab/*` ise `/collab/` ile başlayan yolları eşler;
çıplak `/collab` eşleşmez, istek `reverse_proxy web:3000`'e düşer ve Next 404 verir.
Matcher `/collab*` olur — `handle_path` yine `/collab` önekini soyar, hem `/collab`
hem `/collab/...` eşleşir.

Bu iki hata birbirini gizliyordu: adres hiç geçirilmediği için matcher'ın yanlışlığı
hiç ortaya çıkmamıştı.

**`Dockerfile` ve `deploy.yml` DEĞİŞMEZ.** Bu, yaklaşımın asıl kazancı: değer
build'e gömülmediği için imaj alan adından bağımsız kalır, aynı `latest` etiketi
her sunucuda çalışır.

Değerlendirilip elenenler: `Dockerfile`'a build arg eklemek imajı alan adına
çivilerdi; adresi istemcide `window.location.host`'tan türetmek `/collab` yolunu
istemci koduna gömer ve collab'ı ayrı bir alt alan adına taşımayı kod
değişikliğine bağlardı.

## Çözüm B — sistem rolleri veri migration'ı olur

Üç sistem rolü (`Yönetim Kurulu`, `Genel Sekreter`, `İnsan Kaynakları`) bir
migration'da `ON CONFLICT (slug) DO NOTHING` ile eklenir. `migrate` job'ı her
deploy'da çalıştığı için canlıda kendiliğinden oluşurlar; yeni container ya da
imaj ağırlığı gerekmez. Veri migration'ı bu repo'da yerleşik bir desen
(`promote_superadmin` ve `promote_active_superadmin` aynı mekanizma).

Aynı migration **`Role.position` üzerindeki unique kısıtı düşürür**. İki sebep:

1. Migration sabit 1/2/3 pozisyonlarıyla yazıyor; önceden oluşturulmuş bir rol o
   pozisyonu tutuyorsa `INSERT` `ON CONFLICT (slug)` ile korunmaz ve patlar.
2. Kapsamlı review bu kısıtı zaten gereksiz buldu — sıralamayı değiştiren bir
   arayüz yok ve e2e testi `Math.random() * 1e9` ile etrafından dolaşıyor.

`createRole`'un `max+1` mantığı kısıt olmadan da çalışır; `position` yalnızca
rozet sıralamasıdır.

### `seedSystemRoles` silinir

Rol tanımlarını hem SQL'de hem TypeScript'te tutmak, ikisinin zamanla birbirinden
ayrılması demektir. Migration tek kaynak olur; geliştirici rolleri `pnpm db:migrate`
ile alır. `prisma/seed.ts` yalnızca kurulum davetini üretir — o zaten elle
çalıştırılan bir iş.

**Bootstrap daveti bilerek elde kalır.** `seedBootstrapInvite` başarılı olduğunda
davet URL'sini stdout'a yazar; bunu `migrate` container'ına taşımak, tek kullanımlık
sistem-sahibi kimlik bilgisini her deploy'da container loglarına düşürürdü.

## Regresyon kilidi

Collab hatası e2e'nin yapısal olarak yakalayamayacağı türden, bu yüzden koruma
bir uygulama testi değil bir konfigürasyon testi olur:

```ts
// tests/unit/compose-config.test.ts
it('compose.yml web servisine COLLAB_URL geçirir', () => {
  const compose = readFileSync('compose.yml', 'utf8')
  expect(compose).toMatch(/COLLAB_URL:\s*wss:\/\/\$\{DOMAIN\}\/collab/)
})
```

Kaba ama doğru yeri korur: değişkenin adı değişirse ya da satır silinirse CI düşer.

## Belge güncellemeleri

README'nin deploy bölümü üç yerde gerçekle uyumsuz:

1. **"İlk admini oluşturma"** — davet artık `SUPERADMIN` yetkili. Rol panelinin o
   kapının arkasında olduğu da yazılmalı, yoksa ilk kullanıcı rolleri neden
   yönetemediğini anlamaz.
2. **Servis listesi** `collab`'ı saymıyor (compose'da var).
3. **Bootstrap komutu** — `pnpm db:seed` artık yalnızca daveti üretir, roller
   migration'dan gelir.

## Canlıya çıkış doğrulaması

| # | Adım | Doğrulama |
|---|---|---|
| 1 | GitHub secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` | deploy workflow'u SSH adımında düşmez |
| 2 | `/opt/macs` klonu + `.env` | `docker compose config` hatasız |
| 3 | `main`'e push → CI → deploy | GHCR'da üç imaj, `docker compose ps` hepsi `Up` |
| 4 | `https://<DOMAIN>` → `/login` | TLS sertifikası geçerli |
| 5 | Bootstrap daveti (tek seferlik) | Link ile gir, `SUPERADMIN` olarak açıl |
| 6 | `/admin` → Roller | Üç sistem rolü listede |
| 7 | Doküman aç, ikinci sekmede eşitleme | **Collab düzeltmesinin gerçek kanıtı** |

Adım 7 bu işin asıl sınavı; diğer altısı zaten çalışıyordu.

## Kapsam dışı (bilinçli)

- **`web` ve `collab` için healthcheck.** `restart: unless-stopped` bugünkü tek
  sunuculu kurulum için yeterli; Caddy bağlantıyı yeniden dener.
- **Staging ortamı.** Çözüm A imajı alan adından bağımsız kıldığı için ileride
  eklenebilir, ama şimdi gerekli değil.
- **Yatay ölçekleme, log toplama, metrik.** ~50 kullanıcılık tek sunuculu bir
  kulüp aracı için erken.
