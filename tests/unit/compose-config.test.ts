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
const compose = readFileSync('compose.yml', 'utf8')
const pleskNginx = readFileSync('deploy/plesk-nginx.conf', 'utf8')

describe('compose.yml', () => {
  it('web servisine collab adresini geçirir', () => {
    // `${DOMAIN...}` kısmı `[^}]*` ile eşlenir: DOMAIN çıplak (`${DOMAIN}`)
    // ya da `:?...` guard'lı (`${DOMAIN:?mesaj}`) olabilir, ikisi de geçerli.
    expect(compose).toMatch(/COLLAB_URL:\s*wss:\/\/\$\{DOMAIN[^}]*\}\/collab/)
  })

  it('istemciye gömülen eski NEXT_PUBLIC_ değişkenini kullanmaz', () => {
    expect(compose).not.toContain('NEXT_PUBLIC_COLLAB_URL')
  })

  // Sunucuda Plesk var ve 80/443'ü onun nginx'i tutuyor. Bir zamanlar burada
  // duran caddy servisi o portlara bağlanmaya çalışıp deploy'u düşürürdü.
  it('80/443 portlarını bağlamaz — TLS Plesk’in işi', () => {
    expect(compose).not.toMatch(/['"]?(80:80|443:443)['"]?/)
  })

  // Öneki düşürmek container'ı doğrudan internete açar ve Plesk'in TLS'ini
  // baypas eden şifresiz bir yol bırakır.
  it('yayınlanan portları yalnızca 127.0.0.1’e bağlar', () => {
    const published = [...compose.matchAll(/ports:\s*\[([^\]]+)\]/g)].map((m) => m[1])
    expect(published.length).toBeGreaterThan(0)
    for (const entry of published) {
      expect(entry).toContain('127.0.0.1:')
    }
  })
})

describe('deploy/plesk-nginx.conf', () => {
  /**
   * Hocuspocus provider bağlantı adresini `serverUrl` olarak kurar ve sondaki
   * eğik çizgiyi AKTİF OLARAK siler (hocuspocus-provider.cjs:1962-1967);
   * doküman adı yola değil protokol mesajına gider. Yani websocket isteğinin
   * yolu tam olarak `/collab` — location bloğu çıplak yolu eşlemeli.
   */
  it('çıplak /collab yolunu eşler', () => {
    expect(pleskNginx).toMatch(/location\s+\/collab\s*\{/)
  })

  /**
   * Bu üç satır olmadan nginx websocket yükseltmesini geçirmez: sayfa açılır,
   * editör görünür, hiçbir şey eşitlenmez ve hiçbir yerde hata çıkmaz. Tam
   * olarak bu branch'in kapattığı hatanın nginx katmanındaki karşılığı.
   */
  it('websocket yükseltme başlıklarını geçirir', () => {
    expect(pleskNginx).toMatch(/proxy_http_version\s+1\.1/)
    expect(pleskNginx).toMatch(/proxy_set_header\s+Upgrade\s+\$http_upgrade/)
    expect(pleskNginx).toMatch(/proxy_set_header\s+Connection\s+"upgrade"/)
  })

  // Auth.js bunu okur; eksikse çerezleri http sanıp Secure bayrağını düşürür
  // ve oturum açma sessizce başarısız olur.
  it('X-Forwarded-Proto geçirir', () => {
    expect(pleskNginx).toMatch(/proxy_set_header\s+X-Forwarded-Proto\s+\$scheme/)
  })
})

describe('compose.yml ↔ deploy/plesk-nginx.conf', () => {
  // Yukarıdaki iki describe her dosyayı AYRI doğruluyor; ikisi arasındaki BAĞI
  // hiçbiri kontrol etmiyordu — biri `/collab` yolunu değiştirip diğerini
  // unutursa iki test de sessizce geçerdi.
  it('COLLAB_URL yolu ile nginx location yolu aynı', () => {
    const composePath = compose.match(/COLLAB_URL:\s*wss:\/\/\$\{DOMAIN[^}]*\}(\/[a-z]+)/)?.[1]
    const nginxPath = pleskNginx.match(/location\s+(\/[a-z]+)\s*\{/)?.[1]
    expect(composePath).toBeDefined()
    expect(composePath).toBe(nginxPath)
  })

  // nginx, compose'un host'a yayınladığı portlara proxy'ler; biri değişip
  // diğeri unutulursa 502 alınır.
  it('nginx, compose’un yayınladığı portlara proxy’ler', () => {
    const proxied = [...pleskNginx.matchAll(/proxy_pass\s+http:\/\/127\.0\.0\.1:(\d+)/g)].map((m) => m[1])
    expect(proxied.length).toBe(2)
    for (const port of proxied) {
      expect(compose).toContain(`127.0.0.1:${port}:`)
    }
  })
})
